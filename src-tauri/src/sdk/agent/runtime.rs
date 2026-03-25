use anyhow::{Error, Result};
use futures::StreamExt;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use tokio::time::Duration;
use tracing::{error, info};

use crate::sdk::core::{
    AgentEvent, ChatRequest, DoneEvent, Message, MessageContent, MessagePart, SdkError,
    StreamEvent, ToolCall, ToolResultEvent, ToolStartEvent,
};

use super::{
    cancelled_event, emit_debug, split_think_tags, wait_for_cancellation, Agent,
    MULTIMODAL_COMPLETION_TIMEOUT_SECONDS, STREAM_OPEN_TIMEOUT_SECONDS,
};

pub enum RuntimeControl<T> {
    Completed(T),
    Cancelled,
}

pub struct TurnState {
    pub assistant_text: String,
    pub tool_calls: Vec<ToolCall>,
    pub saw_output: bool,
    pub stream_error: Option<Error>,
    pub had_reasoning: bool,
    in_think_block: bool,
    think_buf: String,
}

impl TurnState {
    pub fn new() -> Self {
        Self {
            assistant_text: String::new(),
            tool_calls: Vec::new(),
            saw_output: false,
            stream_error: None,
            had_reasoning: false,
            in_think_block: false,
            think_buf: String::new(),
        }
    }

    pub async fn apply_text_delta(
        &mut self,
        tx: &mpsc::Sender<Result<AgentEvent>>,
        text: String,
    ) {
        self.saw_output = true;
        let derived = split_think_tags(&text, &mut self.in_think_block, &mut self.think_buf);
        for event in derived {
            match &event {
                AgentEvent::TextDelta(content) => self.assistant_text.push_str(content),
                AgentEvent::ReasoningDelta(_) => self.had_reasoning = true,
                _ => {}
            }
            let _ = tx.send(Ok(event)).await;
        }
    }

    pub async fn flush_pending_think(
        &mut self,
        tx: &mpsc::Sender<Result<AgentEvent>>,
    ) {
        if self.think_buf.is_empty() {
            return;
        }

        if self.in_think_block {
            self.had_reasoning = true;
            let _ = tx
                .send(Ok(AgentEvent::ReasoningDelta(self.think_buf.clone())))
                .await;
        } else {
            self.assistant_text.push_str(&self.think_buf);
            let _ = tx
                .send(Ok(AgentEvent::TextDelta(self.think_buf.clone())))
                .await;
        }

        self.think_buf.clear();
    }

    pub fn apply_reasoning_policy(&mut self, allow_tools_in_reasoning: bool) -> bool {
        if self.had_reasoning && !allow_tools_in_reasoning && !self.tool_calls.is_empty() {
            self.tool_calls.clear();
            return true;
        }

        false
    }

    pub fn into_done_event(self, messages: Vec<Message>) -> AgentEvent {
        AgentEvent::Done(DoneEvent {
            final_text: self.assistant_text,
            messages,
        })
    }
}

pub async fn log_request_debug(
    tx: &mpsc::Sender<Result<AgentEvent>>,
    messages: &[Message],
    request: &ChatRequest,
    iteration: usize,
    contains_inline_images: bool,
) {
    let last_msg_has_images = messages
        .last()
        .map(|message| {
            if let Some(content) = &message.content {
                match content {
                    MessageContent::Multipart(parts) => {
                        let has_images = parts
                            .iter()
                            .any(|part| matches!(part, MessagePart::Image { .. }));
                        format!(
                            "last_msg_content=Multipart, parts={}, has_images={}",
                            parts.len(),
                            has_images
                        )
                    }
                    MessageContent::Plain(text) => {
                        format!("last_msg_content=Plain, len={}", text.len())
                    }
                }
            } else {
                "last_msg_content=None".to_string()
            }
        })
        .unwrap_or_else(|| "no_messages".to_string());

    emit_debug(
        tx,
        "agent",
        format!(
            "Iteration {}: building {} request with {} message(s), image_check_details={}",
            iteration + 1,
            if contains_inline_images {
                "non-streaming multimodal"
            } else {
                "streaming"
            },
            messages.len(),
            last_msg_has_images
        ),
    )
    .await;

    if contains_inline_images {
        if let Some(last_msg) = messages.last() {
            if let Some(MessageContent::Multipart(parts)) = &last_msg.content {
                for (index, part) in parts.iter().enumerate() {
                    if let MessagePart::Image { image_url } = part {
                        let url_preview = if image_url.url.len() > 100 {
                            format!(
                                "{}...[{} total chars]",
                                &image_url.url[..80],
                                image_url.url.len()
                            )
                        } else {
                            image_url.url.clone()
                        };
                        emit_debug(
                            tx,
                            "agent",
                            format!("Image part {}: url_preview={}", index, url_preview),
                        )
                        .await;
                    }
                }
            }
        }
    }

    let request_json =
        serde_json::to_string(request).unwrap_or_else(|_| "serialization_failed".to_string());
    emit_debug(
        tx,
        "agent",
        format!(
            "Request JSON (first 500 chars): {}",
            &request_json[..request_json.len().min(500)]
        ),
    )
    .await;
}

pub async fn run_multimodal_request(
    agent: &Agent,
    tx: &mpsc::Sender<Result<AgentEvent>>,
    cancel_flag: Arc<AtomicBool>,
    messages: &[Message],
    request: ChatRequest,
    request_body_bytes: usize,
    iteration: usize,
) -> Result<RuntimeControl<TurnState>> {
    emit_debug(
        tx,
        "backend",
        format!(
            "Using non-streaming multimodal fallback: request_body={} bytes, iteration={}",
            request_body_bytes,
            iteration + 1
        ),
    )
    .await;

    let response = tokio::select! {
        _ = wait_for_cancellation(cancel_flag) => {
            let _ = tx.send(Ok(cancelled_event(messages))).await;
            return Ok(RuntimeControl::Cancelled);
        }
        _ = tokio::time::sleep(Duration::from_secs(MULTIMODAL_COMPLETION_TIMEOUT_SECONDS)) => {
            let err = Error::new(
                SdkError::provider(format!(
                    "Timed out after {}s waiting for multimodal completion response",
                    MULTIMODAL_COMPLETION_TIMEOUT_SECONDS
                ))
                .with_code("multimodal_completion_timeout")
                .with_retryable(false),
            );
            error!("Multimodal completion timed out: {}", err);
            emit_debug(
                tx,
                "error",
                format!(
                    "Provider completion did not return within {}s (request_body={} bytes)",
                    MULTIMODAL_COMPLETION_TIMEOUT_SECONDS,
                    request_body_bytes
                ),
            )
            .await;
            return Err(err);
        }
        result = agent.provider.complete(request) => result?,
    };

    emit_debug(tx, "stream", "Provider completion returned successfully").await;

    let mut turn = TurnState::new();

    if let Some(usage) = response.usage.clone() {
        let _ = tx.send(Ok(AgentEvent::UsageDelta(usage))).await;
    }

    let Some(choice) = response.choices.into_iter().next() else {
        return Err(Error::new(
            SdkError::provider("Provider returned no completion choices")
                .with_code("empty_completion_choices")
                .with_retryable(false),
        ));
    };

    let content = choice.message.text();
    if !content.is_empty() {
        turn.saw_output = true;
        turn.assistant_text.push_str(&content);
        let _ = tx.send(Ok(AgentEvent::TextDelta(content))).await;
    }

    if let Some(completion_tool_calls) = choice.message.tool_calls {
        for tool_call in completion_tool_calls {
            turn.saw_output = true;
            emit_debug(
                tx,
                "tool",
                format!("Model emitted tool call {}", tool_call.function.name),
            )
            .await;
            turn.tool_calls.push(tool_call);
        }
    }

    emit_debug(
        tx,
        "stream",
        format!(
            "Provider completion finished: text_chars={}, tool_calls={}, saw_output={}",
            turn.assistant_text.len(),
            turn.tool_calls.len(),
            turn.saw_output
        ),
    )
    .await;

    Ok(RuntimeControl::Completed(turn))
}

pub async fn run_streaming_request(
    agent: &Agent,
    tx: &mpsc::Sender<Result<AgentEvent>>,
    cancel_flag: Arc<AtomicBool>,
    messages: &[Message],
    request: ChatRequest,
    request_body_bytes: usize,
    debug_raw: bool,
    iteration: usize,
) -> Result<RuntimeControl<TurnState>> {
    emit_debug(
        tx,
        "backend",
        format!(
            "Opening provider stream: request_body={} bytes, debug_raw={}, iteration={}",
            request_body_bytes,
            debug_raw,
            iteration + 1
        ),
    )
    .await;

    let mut stream = tokio::select! {
        _ = wait_for_cancellation(cancel_flag.clone()) => {
            let _ = tx.send(Ok(cancelled_event(messages))).await;
            return Ok(RuntimeControl::Cancelled);
        }
        _ = tokio::time::sleep(Duration::from_secs(STREAM_OPEN_TIMEOUT_SECONDS)) => {
            let err = Error::new(
                SdkError::provider(format!(
                    "Timed out after {}s waiting for provider to open streaming response",
                    STREAM_OPEN_TIMEOUT_SECONDS
                ))
                .with_code("stream_open_timeout")
                .with_retryable(false),
            );
            error!("Stream open timed out: {}", err);
            emit_debug(
                tx,
                "error",
                format!(
                    "Provider stream did not open within {}s (request_body={} bytes)",
                    STREAM_OPEN_TIMEOUT_SECONDS,
                    request_body_bytes
                ),
            )
            .await;
            return Err(err);
        }
        result = agent.provider.stream(request, debug_raw) => result?,
    };

    emit_debug(tx, "stream", "Provider stream opened successfully").await;

    let mut turn = TurnState::new();

    loop {
        let next_event = tokio::select! {
            _ = wait_for_cancellation(cancel_flag.clone()) => {
                let _ = tx.send(Ok(cancelled_event(messages))).await;
                return Ok(RuntimeControl::Cancelled);
            }
            next_event = stream.next() => next_event,
        };

        let Some(event) = next_event else {
            break;
        };

        match event {
            Ok(StreamEvent::TextDelta(text)) => {
                if !text.is_empty() {
                    turn.apply_text_delta(tx, text).await;
                }
            }
            Ok(StreamEvent::ReasoningDelta(reasoning)) => {
                if !reasoning.is_empty() {
                    turn.saw_output = true;
                    turn.had_reasoning = true;
                    let _ = tx.send(Ok(AgentEvent::ReasoningDelta(reasoning))).await;
                }
            }
            Ok(StreamEvent::UsageDelta(usage)) => {
                let _ = tx.send(Ok(AgentEvent::UsageDelta(usage))).await;
            }
            Ok(StreamEvent::ToolCall {
                id,
                name,
                arguments,
            }) => {
                turn.saw_output = true;
                info!("Tool call received: {} with args: {}", name, arguments);
                emit_debug(tx, "tool", format!("Model emitted tool call {}", name)).await;
                turn.tool_calls.push(ToolCall::new(id, name, arguments));
            }
            Ok(StreamEvent::Raw(raw)) => {
                if debug_raw {
                    emit_debug(tx, "raw", raw).await;
                }
            }
            Ok(StreamEvent::Done) => {
                turn.flush_pending_think(tx).await;
                info!(
                    "Stream done - text: {} chars, tool_calls: {}, saw_output: {}",
                    turn.assistant_text.len(),
                    turn.tool_calls.len(),
                    turn.saw_output
                );
                emit_debug(
                    tx,
                    "stream",
                    format!(
                        "Provider stream signaled done: text_chars={}, tool_calls={}, saw_output={}",
                        turn.assistant_text.len(),
                        turn.tool_calls.len(),
                        turn.saw_output
                    ),
                )
                .await;
                if turn.saw_output {
                    break;
                }
            }
            Err(err) => {
                error!("Stream error: {}", err);
                emit_debug(tx, "error", format!("Provider stream error: {}", err)).await;
                turn.stream_error = Some(err);
                break;
            }
        }
    }

    Ok(RuntimeControl::Completed(turn))
}

pub async fn execute_tool_round(
    agent: &Agent,
    tx: &mpsc::Sender<Result<AgentEvent>>,
    cancel_flag: Arc<AtomicBool>,
    messages: &mut Vec<Message>,
    assistant_text: &str,
    tool_calls: Vec<ToolCall>,
) -> Result<RuntimeControl<()>> {
    info!("Processing {} tool calls", tool_calls.len());
    let content = if assistant_text.is_empty() {
        None
    } else {
        Some(MessageContent::Plain(assistant_text.to_string()))
    };
    messages.push(Message::assistant_with_tool_calls(content, tool_calls.clone()));

    for tool_call in tool_calls {
        if cancel_flag.load(Ordering::SeqCst) {
            let _ = tx.send(Ok(cancelled_event(messages))).await;
            return Ok(RuntimeControl::Cancelled);
        }

        let name = tool_call.function.name.clone();
        let input: Value = serde_json::from_str(&tool_call.function.arguments)
            .unwrap_or_else(|_| Value::String(tool_call.function.arguments.clone()));

        info!("Executing tool: {} with input: {:?}", name, input);
        emit_debug(tx, "tool", format!("Executing tool {}", name)).await;
        let _ = tx
            .send(Ok(AgentEvent::ToolStart(ToolStartEvent {
                name: name.clone(),
                input: input.clone(),
            })))
            .await;

        let result = tokio::select! {
            _ = wait_for_cancellation(cancel_flag.clone()) => {
                let _ = tx.send(Ok(cancelled_event(messages))).await;
                return Ok(RuntimeControl::Cancelled);
            }
            result = agent.execute_tool_with_policy(&name, input) => result,
        };

        let (result_text, success) = match result {
            Ok(output) => {
                info!(
                    "Tool {} succeeded: {} chars output",
                    name,
                    output.llm_output.len()
                );
                emit_debug(
                    tx,
                    "tool",
                    format!(
                        "Tool {} succeeded with {} chars of output",
                        name,
                        output.llm_output.len()
                    ),
                )
                .await;
                (output.llm_output, true)
            }
            Err(err) => {
                error!("Tool {} failed: {}", name, err);
                emit_debug(tx, "error", format!("Tool {} failed: {}", name, err)).await;
                (format!("Error: {}", err), false)
            }
        };

        messages.push(Message::tool_result(
            tool_call.id.clone(),
            result_text.clone(),
        ));

        let _ = tx
            .send(Ok(AgentEvent::ToolResult(ToolResultEvent {
                name,
                result: result_text,
                success,
            })))
            .await;
    }

    emit_debug(tx, "agent", "Tool execution phase complete; continuing agent loop").await;
    info!("Tool execution complete, continuing to next iteration");
    Ok(RuntimeControl::Completed(()))
}
