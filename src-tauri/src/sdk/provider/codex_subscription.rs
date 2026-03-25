use anyhow::{anyhow, Error, Result};
use async_trait::async_trait;
use bytes::Bytes;
use futures::{stream, Stream, StreamExt};
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::path::PathBuf;

use crate::commands::codex_auth::ensure_valid_auth;
use crate::sdk::core::SdkError;
use crate::sdk::core::{
    ChatRequest, ChatResponse, Choice, Message, MessageContent, MessagePart, ResponseStreamError,
    StreamEvent, ToolCall, Usage,
};
use crate::sdk::provider::{infer_model_capabilities, ModelInfo, Provider};

const CODEX_BASE_URL: &str = "https://chatgpt.com/backend-api";
const CODEX_RESPONSES_PATH: &str = "codex/responses";

#[derive(Clone)]
pub struct CodexSubscriptionProvider {
    client: reqwest::Client,
    auth_path: PathBuf,
    model: String,
}

impl CodexSubscriptionProvider {
    pub fn new(auth_path: PathBuf, model: &str) -> Result<Self> {
        if model.trim().is_empty() {
            return Err(anyhow!("Model ID is required"));
        }

        Ok(Self {
            client: reqwest::Client::new(),
            auth_path,
            model: normalize_codex_model(model),
        })
    }

    async fn create_headers(&self) -> Result<HeaderMap> {
        let auth = ensure_valid_auth(&self.auth_path).await?;
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", auth.access_token))?,
        );
        headers.insert(
            "chatgpt-account-id",
            HeaderValue::from_str(&auth.chatgpt_account_id)?,
        );
        headers.insert(
            "OpenAI-Beta",
            HeaderValue::from_static("responses=experimental"),
        );
        headers.insert("originator", HeaderValue::from_static("codex_cli_rs"));
        headers.insert("accept", HeaderValue::from_static("text/event-stream"));
        Ok(headers)
    }

    fn build_request_body(&self, request: ChatRequest) -> Value {
        let mut instructions = Vec::new();
        let mut input = Vec::new();

        for message in request.messages {
            match message.role.as_str() {
                "system" => {
                    let text = message.text();
                    if !text.trim().is_empty() {
                        instructions.push(text);
                    }
                }
                "tool" => {
                    if let Some(tool_call_id) = message.tool_call_id.as_ref() {
                        input.push(json!({
                            "type": "function_call_output",
                            "call_id": tool_call_id,
                            "output": message.text(),
                        }));
                    }
                }
                "assistant" => {
                    let assistant_message =
                        message_to_codex_input_with_text_kind(&message, "output_text");
                    if assistant_message
                        .get("content")
                        .and_then(Value::as_array)
                        .is_some_and(|content| !content.is_empty())
                    {
                        input.push(assistant_message);
                    }
                    if let Some(tool_calls) = message.tool_calls {
                        for tool_call in tool_calls {
                            input.push(json!({
                                "type": "function_call",
                                "call_id": tool_call.id,
                                "name": tool_call.function.name,
                                "arguments": tool_call.function.arguments,
                            }));
                        }
                    }
                }
                _ => {
                    input.push(message_to_codex_input(&message));
                }
            }
        }

        let mut body = json!({
            "model": self.model,
            "store": false,
            "stream": true,
            "include": ["reasoning.encrypted_content"],
            "input": input,
        });

        if !instructions.is_empty() {
            body["instructions"] = Value::String(instructions.join("\n\n"));
        }

        if let Some(tools) = request.tools {
            let transformed_tools = tools
                .into_iter()
                .map(|tool| {
                    json!({
                        "type": "function",
                        "name": tool.function.name,
                        "description": tool.function.description,
                        "parameters": tool.function.parameters,
                    })
                })
                .collect::<Vec<_>>();
            body["tools"] = Value::Array(transformed_tools);
        }

        body
    }

    async fn send_request(&self, body: &Value) -> Result<reqwest::Response> {
        let headers = self.create_headers().await?;
        let response = self
            .client
            .post(format!("{}/{}", CODEX_BASE_URL, CODEX_RESPONSES_PATH))
            .headers(headers)
            .json(body)
            .send()
            .await
            .map_err(map_reqwest_error)?;

        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(Error::new(
                SdkError::from_status(status, format!("Codex API error ({}): {}", status, text))
                    .with_code("http_error"),
            ));
        }

        Ok(response)
    }
}

#[async_trait]
impl Provider for CodexSubscriptionProvider {
    fn id(&self) -> &'static str {
        "codex_subscription"
    }

    fn model(&self) -> &str {
        &self.model
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            id: self.model.clone(),
            display_name: self.model.clone(),
            provider_id: self.id().to_string(),
            context_window: Some(272_000),
            max_output_tokens: Some(128_000),
            capabilities: infer_model_capabilities(&self.model),
        }
    }

    async fn complete(&self, request: ChatRequest) -> Result<ChatResponse> {
        let body = self.build_request_body(request);
        let response = self.send_request(&body).await?;
        let sse_text = response.text().await.map_err(map_reqwest_error)?;
        parse_final_chat_response(&sse_text)
    }

    async fn stream(
        &self,
        request: ChatRequest,
        debug_raw: bool,
    ) -> Result<Box<dyn Stream<Item = Result<StreamEvent>> + Send + Unpin>> {
        let body = self.build_request_body(request);
        let response = self.send_request(&body).await?;
        Ok(Box::new(parse_codex_sse_stream(
            response.bytes_stream(),
            debug_raw,
        )))
    }
}

fn message_to_codex_input(message: &Message) -> Value {
    message_to_codex_input_with_text_kind(message, "input_text")
}

fn message_to_codex_input_with_text_kind(message: &Message, text_kind: &str) -> Value {
    let content = match message.content.as_ref() {
        Some(MessageContent::Plain(text)) => vec![json!({
            "type": text_kind,
            "text": text,
        })],
        Some(MessageContent::Multipart(parts)) => multipart_to_codex_content(parts, text_kind),
        None => vec![],
    };

    json!({
        "type": "message",
        "role": message.role,
        "content": content,
    })
}

fn multipart_to_codex_content(parts: &[MessagePart], text_kind: &str) -> Vec<Value> {
    parts
        .iter()
        .filter_map(|part| match part {
            MessagePart::Text { text } => Some(json!({
                "type": text_kind,
                "text": text,
            })),
            MessagePart::Image { image_url } => Some(json!({
                "type": "input_image",
                "image_url": image_url.url,
                "detail": image_url.detail.clone().unwrap_or_else(|| "low".to_string()),
            })),
        })
        .collect()
}

fn parse_final_chat_response(sse_text: &str) -> Result<ChatResponse> {
    let parsed = parse_codex_sse_snapshot(sse_text)?;
    codex_snapshot_to_chat_response(parsed)
}

fn parse_codex_sse_snapshot(sse_text: &str) -> Result<CodexResponseSnapshot> {
    let mut snapshot = CodexResponseSnapshot::default();

    for line in sse_text.lines() {
        let Some(data) = line
            .trim_end()
            .strip_prefix("data: ")
            .or_else(|| line.trim_end().strip_prefix("data:"))
        else {
            continue;
        };

        if data == "[DONE]" {
            continue;
        }

        let parsed = serde_json::from_str::<Value>(data).map_err(|error| {
            Error::new(SdkError::stream(format!(
                "Failed to parse Codex SSE payload: {}",
                error
            )))
        })?;

        if let Some(error) = parse_event_error(&parsed) {
            return Err(Error::new(error));
        }

        let event_type = parsed
            .get("type")
            .and_then(Value::as_str)
            .unwrap_or_default();

        match event_type {
            "response.output_text.delta" => {
                if let Some(delta) = parsed.get("delta").and_then(Value::as_str) {
                    if !delta.is_empty() {
                        snapshot.text.push_str(delta);
                        snapshot.saw_text_output = true;
                    }
                }
            }
            "response.output_item.done" => {
                if let Some(item) = parsed.get("item") {
                    snapshot.record_output_item(item);
                }
            }
            "response.done" | "response.completed" => {
                let response = parsed
                    .get("response")
                    .ok_or_else(|| anyhow!("Codex response event missing response payload"))?;
                snapshot.apply_response(response);
            }
            _ => {}
        }
    }

    if snapshot.response_id.is_empty() {
        return Err(anyhow!(
            "Codex response did not contain a final response payload"
        ));
    }

    Ok(snapshot)
}

fn codex_snapshot_to_chat_response(snapshot: CodexResponseSnapshot) -> Result<ChatResponse> {
    let finish_reason = if snapshot.tool_calls.is_empty() {
        Some("stop".to_string())
    } else {
        Some("tool_calls".to_string())
    };

    Ok(ChatResponse {
        id: snapshot.response_id,
        choices: vec![Choice {
            index: 0,
            message: if snapshot.tool_calls.is_empty() {
                Message::assistant_text(snapshot.text)
            } else {
                Message::assistant_with_tool_calls(
                    if snapshot.text.trim().is_empty() {
                        None
                    } else {
                        Some(MessageContent::Plain(snapshot.text))
                    },
                    snapshot.tool_calls,
                )
            },
            finish_reason,
        }],
        usage: snapshot.usage,
    })
}

fn parse_codex_sse_stream(
    byte_stream: impl Stream<Item = reqwest::Result<Bytes>> + Unpin + Send + 'static,
    debug_raw: bool,
) -> impl Stream<Item = Result<StreamEvent>> {
    let mut buffer = String::new();
    let mut saw_text_output = false;
    let mut tool_call_ids = HashSet::new();
    let mut delta_item_ids = HashSet::new();

    byte_stream.flat_map(move |chunk| {
        let mut events = Vec::new();

        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes).replace("\r\n", "\n");
                buffer.push_str(&text);

                while let Some(pos) = buffer.find('\n') {
                    let line = buffer[..pos].to_string();
                    buffer = buffer[pos + 1..].to_string();
                    let trimmed = line.trim_end();
                    let Some(data) = trimmed
                        .strip_prefix("data: ")
                        .or_else(|| trimmed.strip_prefix("data:"))
                    else {
                        continue;
                    };
                    let payload = data.trim_start();
                    if payload.is_empty() || payload == "[DONE]" {
                        continue;
                    }

                    if debug_raw {
                        events.push(Ok(StreamEvent::Raw(payload.to_string())));
                    }

                    let parsed = match serde_json::from_str::<Value>(payload) {
                        Ok(value) => value,
                        Err(error) => {
                            events.push(Err(Error::new(SdkError::stream(format!(
                                "Failed to parse Codex SSE payload: {}",
                                error
                            )))));
                            continue;
                        }
                    };

                    if let Some(error) = parse_event_error(&parsed) {
                        events.push(Err(Error::new(error)));
                        continue;
                    }

                    let event_type = parsed
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or_default();

                    match event_type {
                        "response.output_text.delta" => {
                            if let Some(delta) = parsed.get("delta").and_then(Value::as_str) {
                                if !delta.is_empty() {
                                    saw_text_output = true;
                                    if let Some(item_id) =
                                        parsed.get("item_id").and_then(Value::as_str)
                                    {
                                        delta_item_ids.insert(item_id.to_string());
                                    }
                                    events.push(Ok(StreamEvent::TextDelta(delta.to_string())));
                                }
                            }
                        }
                        "response.output_item.done" => {
                            if let Some(item) = parsed.get("item") {
                                emit_output_item_events(
                                    item,
                                    &mut events,
                                    &mut saw_text_output,
                                    &delta_item_ids,
                                    &mut tool_call_ids,
                                );
                            }
                        }
                        "response.done" | "response.completed" => match parsed.get("response") {
                            Some(response) => {
                                if let Some(usage) = parse_usage(response.get("usage")) {
                                    events.push(Ok(StreamEvent::UsageDelta(usage)));
                                }
                                if let Some(output) =
                                    response.get("output").and_then(Value::as_array)
                                {
                                    if !saw_text_output {
                                        let (text, _) = parse_output_items(output);
                                        if !text.is_empty() {
                                            saw_text_output = true;
                                            events.push(Ok(StreamEvent::TextDelta(text)));
                                        }
                                    }
                                    for tool_call in parse_output_items(output).1 {
                                        if tool_call_ids.insert(tool_call.id.clone()) {
                                            events.push(Ok(StreamEvent::ToolCall {
                                                id: tool_call.id,
                                                name: tool_call.function.name,
                                                arguments: tool_call.function.arguments,
                                            }));
                                        }
                                    }
                                }
                                events.push(Ok(StreamEvent::Done));
                            }
                            None => events.push(Err(anyhow!(
                                "Codex response event missing response payload"
                            )
                            .into())),
                        },
                        _ => {}
                    }
                }
            }
            Err(error) => {
                events.push(Err(Error::new(SdkError::stream(format!(
                    "Codex stream error: {}",
                    error
                )))));
            }
        }

        stream::iter(events)
    })
}

fn emit_output_item_events(
    item: &Value,
    events: &mut Vec<Result<StreamEvent>>,
    saw_text_output: &mut bool,
    delta_item_ids: &HashSet<String>,
    tool_call_ids: &mut HashSet<String>,
) {
    match item.get("type").and_then(Value::as_str).unwrap_or_default() {
        "message" => {
            let item_id = item.get("id").and_then(Value::as_str);
            let should_emit_full_text = item_id.is_none_or(|id| !delta_item_ids.contains(id));
            if should_emit_full_text {
                let text = parse_message_text(item);
                if !text.is_empty() {
                    *saw_text_output = true;
                    events.push(Ok(StreamEvent::TextDelta(text)));
                }
            }
        }
        "function_call" => {
            if let Some(tool_call) = parse_function_call(item) {
                if tool_call_ids.insert(tool_call.id.clone()) {
                    events.push(Ok(StreamEvent::ToolCall {
                        id: tool_call.id,
                        name: tool_call.function.name,
                        arguments: tool_call.function.arguments,
                    }));
                }
            }
        }
        _ => {}
    }
}

fn parse_output_items(output: &[Value]) -> (String, Vec<ToolCall>) {
    let mut text_chunks = Vec::new();
    let mut tool_calls = Vec::new();

    for item in output {
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message" => {
                if let Some(content) = item.get("content").and_then(Value::as_array) {
                    for part in content {
                        match part.get("type").and_then(Value::as_str).unwrap_or_default() {
                            "output_text" | "text" | "input_text" => {
                                if let Some(text) = part.get("text").and_then(Value::as_str) {
                                    if !text.is_empty() {
                                        text_chunks.push(text.to_string());
                                    }
                                }
                            }
                            _ => {}
                        }
                    }
                }
            }
            "function_call" => {
                let call_id = item
                    .get("call_id")
                    .or_else(|| item.get("id"))
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let name = item
                    .get("name")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                let arguments = item
                    .get("arguments")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .to_string();
                if !name.is_empty() {
                    tool_calls.push(ToolCall::new(call_id, name, arguments));
                }
            }
            _ => {}
        }
    }

    (text_chunks.join(""), tool_calls)
}

fn parse_message_text(item: &Value) -> String {
    item.get("content")
        .and_then(Value::as_array)
        .map(|content| {
            content
                .iter()
                .filter_map(|part| match part.get("type").and_then(Value::as_str) {
                    Some("output_text" | "text" | "input_text") => {
                        part.get("text").and_then(Value::as_str)
                    }
                    _ => None,
                })
                .filter(|text| !text.is_empty())
                .collect::<String>()
        })
        .unwrap_or_default()
}

fn parse_function_call(item: &Value) -> Option<ToolCall> {
    let call_id = item
        .get("call_id")
        .or_else(|| item.get("id"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let name = item
        .get("name")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let arguments = item
        .get("arguments")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    if name.is_empty() {
        None
    } else {
        Some(ToolCall::new(call_id, name, arguments))
    }
}

#[derive(Default)]
struct CodexResponseSnapshot {
    response_id: String,
    usage: Option<Usage>,
    text: String,
    tool_calls: Vec<ToolCall>,
    tool_call_ids: HashSet<String>,
    saw_text_output: bool,
}

impl CodexResponseSnapshot {
    fn record_output_item(&mut self, item: &Value) {
        match item.get("type").and_then(Value::as_str).unwrap_or_default() {
            "message" => {
                let text = parse_message_text(item);
                if !text.is_empty() && !self.saw_text_output {
                    self.text.push_str(&text);
                    self.saw_text_output = true;
                }
            }
            "function_call" => {
                if let Some(tool_call) = parse_function_call(item) {
                    if self.tool_call_ids.insert(tool_call.id.clone()) {
                        self.tool_calls.push(tool_call);
                    }
                }
            }
            _ => {}
        }
    }

    fn apply_response(&mut self, response: &Value) {
        if let Some(response_id) = response.get("id").and_then(Value::as_str) {
            self.response_id = response_id.to_string();
        }

        if let Some(usage) = parse_usage(response.get("usage")) {
            self.usage = Some(usage);
        }

        let output = response
            .get("output")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let (text, tool_calls) = parse_output_items(&output);

        if !text.is_empty() && !self.saw_text_output {
            self.text = text;
            self.saw_text_output = true;
        }

        for tool_call in tool_calls {
            if self.tool_call_ids.insert(tool_call.id.clone()) {
                self.tool_calls.push(tool_call);
            }
        }
    }
}

fn parse_usage(value: Option<&Value>) -> Option<Usage> {
    let usage = value?;
    Some(Usage {
        prompt_tokens: usage
            .get("input_tokens")
            .or_else(|| usage.get("prompt_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        completion_tokens: usage
            .get("output_tokens")
            .or_else(|| usage.get("completion_tokens"))
            .and_then(Value::as_u64)
            .map(|value| value as u32),
        total_tokens: usage
            .get("total_tokens")
            .and_then(Value::as_u64)
            .map(|value| value as u32),
    })
}

fn parse_event_error(value: &Value) -> Option<SdkError> {
    let error = value.get("error")?;
    let stream_error = serde_json::from_value::<ResponseStreamError>(error.clone()).ok()?;
    Some(
        SdkError::provider(
            stream_error
                .message
                .unwrap_or_else(|| "Unknown Codex stream error".to_string()),
        )
        .with_code(
            stream_error
                .code
                .or(stream_error.r#type)
                .unwrap_or_else(|| "provider_stream".to_string()),
        ),
    )
}

fn normalize_codex_model(model: &str) -> String {
    let model = model.trim();
    let lower = model.to_lowercase();
    if lower.contains("gpt-5.2-codex") {
        return "gpt-5.2-codex".to_string();
    }
    if lower.contains("codex-max") {
        return "gpt-5.1-codex-max".to_string();
    }
    if lower.contains("codex-mini") {
        return "gpt-5.1-codex-mini".to_string();
    }
    if lower.contains("codex") {
        return "gpt-5.1-codex".to_string();
    }
    model.to_string()
}

fn map_reqwest_error(error: reqwest::Error) -> Error {
    if error.is_timeout() {
        return Error::new(SdkError::timeout(format!(
            "Codex request timed out: {}",
            error
        )));
    }
    if error.is_connect() || error.is_request() {
        return Error::new(
            SdkError::provider(format!("Codex network request failed: {}", error))
                .with_retryable(true),
        );
    }
    Error::new(SdkError::provider(format!(
        "Codex request failed: {}",
        error
    )))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sdk::core::Message;

    #[test]
    fn assistant_history_uses_output_text_content() {
        let provider = CodexSubscriptionProvider::new(PathBuf::from("auth.json"), "gpt-5.1-codex")
            .expect("provider");

        let request = ChatRequest {
            model: "gpt-5.1-codex".to_string(),
            messages: vec![
                Message::user("hello".to_string()),
                Message::assistant_text("hi there".to_string()),
            ],
            tools: None,
            tool_choice: None,
            stream: true,
            max_tokens: None,
            temperature: None,
        };

        let body = provider.build_request_body(request);
        let input = body["input"].as_array().expect("input array");

        assert_eq!(input[0]["content"][0]["type"], "input_text");
        assert_eq!(input[1]["content"][0]["type"], "output_text");
    }

    #[test]
    fn parses_tool_calls_from_output_item_done_when_completed_output_is_empty() {
        let sse = concat!(
            "data: {\"type\":\"response.output_item.done\",\"item\":{\"type\":\"function_call\",\"call_id\":\"call_1\",\"name\":\"read_file\",\"arguments\":\"{\\\"path\\\":\\\"README.md\\\"}\"}}\n",
            "data: {\"type\":\"response.completed\",\"response\":{\"id\":\"resp_1\",\"output\":[],\"usage\":{\"input_tokens\":10,\"output_tokens\":5,\"total_tokens\":15}}}\n",
        );

        let response = parse_final_chat_response(sse).expect("parsed response");
        let choice = &response.choices[0];
        let tool_calls = choice
            .message
            .tool_calls
            .as_ref()
            .expect("tool calls present");

        assert_eq!(response.id, "resp_1");
        assert_eq!(tool_calls.len(), 1);
        assert_eq!(tool_calls[0].function.name, "read_file");
    }
}
