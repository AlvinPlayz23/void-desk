//! Agent module - Orchestrates provider + tools + session

use anyhow::{anyhow, Error, Result};
use futures::StreamExt;
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};
use tokio_stream::wrappers::ReceiverStream;
use tracing::{debug, error, info};

use crate::sdk::client::AIClient;
use crate::sdk::core::{
    ChatRequest, ErrorCategory, InlineImageAttachment, Message, MessageContent, MessagePart,
    SdkError, StreamEvent, ToolCall, Usage,
};
use crate::sdk::tools::{AgentToolOutput, ToolPolicy, ToolRegistry};

const DEFAULT_MAX_ITERATIONS: usize = 3000;
const MAX_CONSECUTIVE_SELF_CORRECTIONS: usize = 10;
const STREAM_OPEN_TIMEOUT_SECONDS: u64 = 45;
const MULTIMODAL_COMPLETION_TIMEOUT_SECONDS: u64 = 180;

/// Events emitted by the agent during execution
#[derive(Debug, Clone)]
pub enum AgentEvent {
    TextDelta(String),
    ReasoningDelta(String),
    UsageDelta(Usage),
    ToolStart {
        name: String,
        input: Value,
    },
    ToolResult {
        name: String,
        result: String,
        success: bool,
    },
    Debug {
        kind: String,
        message: String,
    },
    Cancelled {
        reason: String,
        messages: Vec<Message>,
    },
    Done {
        final_text: String,
        messages: Vec<Message>,
    },
}

/// Result of agent execution
#[derive(Debug, Clone)]
pub struct AgentResult {
    pub text: String,
    pub messages: Vec<Message>,
}

#[derive(Clone, Debug)]
pub struct AgentRunHandle {
    cancelled: Arc<AtomicBool>,
}

impl AgentRunHandle {
    pub fn cancel(&self) {
        self.cancelled.store(true, Ordering::SeqCst);
    }

    pub fn is_cancelled(&self) -> bool {
        self.cancelled.load(Ordering::SeqCst)
    }
}

/// AI Agent that orchestrates model calls, tool execution, and history
#[derive(Clone)]
pub struct Agent {
    client: AIClient,
    tools: ToolRegistry,
    system_prompt: Option<String>,
    max_iterations: usize,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

impl Agent {
    pub fn new(client: AIClient) -> Self {
        Self {
            client,
            tools: ToolRegistry::new(),
            system_prompt: None,
            max_iterations: DEFAULT_MAX_ITERATIONS,
            max_tokens: None,
            temperature: Some(0.2),
        }
    }

    pub fn with_tool(mut self, tool: Arc<dyn crate::sdk::tools::AgentTool>) -> Self {
        self.tools.register(tool);
        self
    }

    pub fn with_tool_policy(mut self, policy: ToolPolicy) -> Self {
        self.tools.set_policy(policy);
        self
    }

    pub fn with_system_prompt(mut self, prompt: String) -> Self {
        self.system_prompt = Some(prompt);
        self
    }

    pub fn with_max_iterations(mut self, max: usize) -> Self {
        self.max_iterations = max;
        self
    }

    pub fn with_max_tokens(mut self, max: u32) -> Self {
        self.max_tokens = Some(max);
        self
    }

    pub fn with_temperature(mut self, temperature: f32) -> Self {
        self.temperature = Some(temperature);
        self
    }

    pub async fn run(&self, user_message: String, history: Vec<Message>) -> Result<AgentResult> {
        let mut messages = history;
        let mut consecutive_self_corrections = 0_usize;
        messages.push(Message::user(user_message));

        for _ in 0..self.max_iterations {
            let request = self.build_request(messages.clone(), false);
            let response = match self.client.complete(request).await {
                Ok(r) => r,
                Err(err) => {
                    error!("API request failed, feeding error back: {}", err);
                    register_self_correction_attempt(
                        &mut consecutive_self_corrections,
                        &err,
                        "API request",
                    )?;
                    let error_msg = format!(
                        "The API rejected the previous request with an error: {}. \
                        Please try again with a corrected approach.",
                        err
                    );
                    messages.push(Message::user(error_msg));
                    continue;
                }
            };

            consecutive_self_corrections = 0;

            let choice = match response.choices.first() {
                Some(c) => c,
                None => {
                    messages.push(Message::user(
                        "No response was returned from the model. Please try again.".to_string(),
                    ));
                    continue;
                }
            };

            let assistant_message = choice.message.clone();
            let text = assistant_message.text();
            messages.push(assistant_message.clone());

            if let Some(tool_calls) = &assistant_message.tool_calls {
                for tool_call in tool_calls {
                    let name = &tool_call.function.name;
                    let input: Value = serde_json::from_str(&tool_call.function.arguments)
                        .unwrap_or_else(|_| Value::String(tool_call.function.arguments.clone()));

                    let result = self.execute_tool_with_policy(name, input).await;
                    let result_text = match result {
                        Ok(output) => output.llm_output,
                        Err(err) => format!("Error: {}", err),
                    };

                    messages.push(Message::tool_result(tool_call.id.clone(), result_text));
                }
            } else {
                return Ok(AgentResult { text, messages });
            }
        }

        Err(anyhow!(
            "Max iterations ({}) reached without completion",
            self.max_iterations
        ))
    }

    pub async fn run_streaming(
        &self,
        user_message: String,
        history: Vec<Message>,
    ) -> Result<impl futures::Stream<Item = Result<AgentEvent>>> {
        let (stream, _) = self
            .run_streaming_with_handle(user_message, history, false, vec![])
            .await?;
        Ok(stream)
    }

    pub async fn run_streaming_with_debug(
        &self,
        user_message: String,
        history: Vec<Message>,
        debug_raw: bool,
    ) -> Result<impl futures::Stream<Item = Result<AgentEvent>>> {
        let (stream, _) = self
            .run_streaming_with_handle(user_message, history, debug_raw, vec![])
            .await?;
        Ok(stream)
    }

    pub async fn run_streaming_with_handle(
        &self,
        user_message: String,
        history: Vec<Message>,
        debug_raw: bool,
        image_attachments: Vec<InlineImageAttachment>,
    ) -> Result<(
        impl futures::Stream<Item = Result<AgentEvent>>,
        AgentRunHandle,
    )> {
        let agent = self.clone();
        let (tx, rx) = mpsc::channel(64);
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let handle = AgentRunHandle {
            cancelled: cancel_flag.clone(),
        };

        tokio::spawn(async move {
            let mut messages = history;
            let mut consecutive_self_corrections = 0_usize;
            let image_count = image_attachments.len();
            let total_image_bytes: usize = image_attachments
                .iter()
                .map(|attachment| {
                    attachment
                        .optimized_bytes
                        .or(attachment.source_bytes)
                        .unwrap_or(attachment.data_url.len())
                })
                .sum();
            if image_attachments.is_empty() {
                messages.push(Message::user(user_message.clone()));
            } else {
                messages.push(Message::user_multipart(user_message.clone(), image_attachments));
            }
            
            // Debug: verify the message structure after creation
            if let Some(last) = messages.last() {
                let content_desc = match &last.content {
                    Some(MessageContent::Multipart(parts)) => {
                        let img_count = parts.iter().filter(|p| matches!(p, MessagePart::Image { .. })).count();
                        format!("Multipart with {} parts, {} images", parts.len(), img_count)
                    }
                    Some(MessageContent::Plain(t)) => format!("Plain text ({} chars)", t.len()),
                    None => "None".to_string(),
                };
                emit_debug(&tx, "agent", format!("Created user message: {}", content_desc)).await;
            }
            
            info!("Agent starting with message: {}", user_message);
            emit_debug(
                &tx,
                "agent",
                format!(
                    "Agent run starting: history_messages={}, user_chars={}, inline_images={}, image_bytes={}",
                    messages.len().saturating_sub(1),
                    user_message.len(),
                    image_count,
                    total_image_bytes
                ),
            )
            .await;
            emit_debug(
                &tx,
                "attachment",
                if image_count > 0 {
                    format!(
                        "Built multipart user message with {} inline image(s), total_image_bytes={}",
                        image_count, total_image_bytes
                    )
                } else {
                    "Built text-only user message".to_string()
                },
            )
            .await;

            for iteration in 0..agent.max_iterations {
                if cancel_flag.load(Ordering::SeqCst) {
                    let _ = tx
                        .send(Ok(AgentEvent::Cancelled {
                            reason: "Cancelled by user".to_string(),
                            messages: messages.clone(),
                        }))
                        .await;
                    return;
                }

                info!(
                    "Agent iteration {} - {} messages in history",
                    iteration,
                    messages.len()
                );
                let contains_inline_images = messages_include_inline_images(&messages);
                
                // Debug: Log the actual message content structure
                let last_msg_has_images = messages.last().map(|m| {
                    if let Some(content) = &m.content {
                        match content {
                            MessageContent::Multipart(parts) => {
                                let has_images = parts.iter().any(|p| matches!(p, MessagePart::Image { .. }));
                                format!("last_msg_content=Multipart, parts={}, has_images={}", parts.len(), has_images)
                            }
                            MessageContent::Plain(t) => format!("last_msg_content=Plain, len={}", t.len()),
                        }
                    } else {
                        "last_msg_content=None".to_string()
                    }
                }).unwrap_or_else(|| "no_messages".to_string());
                
                emit_debug(
                    &tx,
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
                let request = agent.build_request(messages.clone(), !contains_inline_images);
                let request_json = serde_json::to_string(&request).unwrap_or_else(|_| "serialization_failed".to_string());
                
                // Log the image URL format specifically
                if contains_inline_images {
                    if let Some(last_msg) = messages.last() {
                        if let Some(MessageContent::Multipart(parts)) = &last_msg.content {
                            for (i, part) in parts.iter().enumerate() {
                                if let MessagePart::Image { image_url } = part {
                                    let url_preview = if image_url.url.len() > 100 {
                                        format!("{}...[{} total chars]", &image_url.url[..80], image_url.url.len())
                                    } else {
                                        image_url.url.clone()
                                    };
                                    emit_debug(&tx, "agent", format!("Image part {}: url_preview={}", i, url_preview)).await;
                                }
                            }
                        }
                    }
                }
                
                emit_debug(&tx, "agent", format!("Request JSON (first 500 chars): {}", &request_json[..request_json.len().min(500)])).await;

                let request_body_bytes = serde_json::to_vec(&request).map(|body| body.len()).unwrap_or(0);
                let mut assistant_text = String::new();
                let mut tool_calls: Vec<ToolCall> = Vec::new();
                let mut saw_output = false;
                let mut stream_error: Option<Error> = None;

                if contains_inline_images {
                    emit_debug(
                        &tx,
                        "backend",
                        format!(
                            "Using non-streaming multimodal fallback: request_body={} bytes, iteration={}",
                            request_body_bytes,
                            iteration + 1
                        ),
                    )
                    .await;

                    let response = match timeout(
                        Duration::from_secs(MULTIMODAL_COMPLETION_TIMEOUT_SECONDS),
                        agent.client.complete(request),
                    )
                    .await
                    {
                        Ok(Ok(response)) => response,
                        Ok(Err(err)) => {
                            error!("Completion request failed: {}", err);
                            let attempt = match register_self_correction_attempt(
                                &mut consecutive_self_corrections,
                                &err,
                                "API request",
                            ) {
                                Ok(attempt) => attempt,
                                Err(limit_err) => {
                                    let _ = tx.send(Err(limit_err)).await;
                                    return;
                                }
                            };
                            emit_debug(
                                &tx,
                                "retry",
                                format!(
                                    "API request failed; asking model to self-correct ({}/{}): {}",
                                    attempt, MAX_CONSECUTIVE_SELF_CORRECTIONS, err
                                ),
                            )
                            .await;
                            let error_msg = format!(
                                "The API rejected the previous request with an error: {}. \
                                This may be due to a malformed tool call or invalid message format. \
                                Please try again with a corrected approach.",
                                err
                            );
                            let _ = tx
                                .send(Ok(AgentEvent::TextDelta(format!(
                                    "\n\n*[Retrying after API error ({}/{})...]*\n\n",
                                    attempt, MAX_CONSECUTIVE_SELF_CORRECTIONS
                                ))))
                                .await;
                            messages.push(Message::user(error_msg));
                            continue;
                        }
                        Err(_) => {
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
                                &tx,
                                "error",
                                format!(
                                    "Provider completion did not return within {}s (request_body={} bytes)",
                                    MULTIMODAL_COMPLETION_TIMEOUT_SECONDS,
                                    request_body_bytes
                                ),
                            )
                            .await;
                            let _ = tx.send(Err(err)).await;
                            return;
                        }
                    };

                    emit_debug(&tx, "stream", "Provider completion returned successfully").await;

                    if let Some(usage) = response.usage.clone() {
                        let _ = tx.send(Ok(AgentEvent::UsageDelta(usage))).await;
                    }

                    let Some(choice) = response.choices.into_iter().next() else {
                        let err = Error::new(
                            SdkError::provider("Provider returned no completion choices")
                                .with_code("empty_completion_choices")
                                .with_retryable(false),
                        );
                        emit_debug(&tx, "error", format!("Provider completion error: {}", err)).await;
                        let _ = tx.send(Err(err)).await;
                        return;
                    };

                    let content = choice.message.text();
                    if !content.is_empty() {
                        saw_output = true;
                        assistant_text.push_str(&content);
                        let _ = tx.send(Ok(AgentEvent::TextDelta(content))).await;
                    }

                    if let Some(completion_tool_calls) = choice.message.tool_calls {
                        for tool_call in completion_tool_calls {
                            saw_output = true;
                            emit_debug(
                                &tx,
                                "tool",
                                format!("Model emitted tool call {}", tool_call.function.name),
                            )
                            .await;
                            tool_calls.push(tool_call);
                        }
                    }

                    emit_debug(
                        &tx,
                        "stream",
                        format!(
                            "Provider completion finished: text_chars={}, tool_calls={}, saw_output={}",
                            assistant_text.len(),
                            tool_calls.len(),
                            saw_output
                        ),
                    )
                    .await;
                } else {
                    emit_debug(
                        &tx,
                        "backend",
                        format!(
                            "Opening provider stream: request_body={} bytes, debug_raw={}, iteration={}",
                            request_body_bytes,
                            debug_raw,
                            iteration + 1
                        ),
                    )
                    .await;

                    let mut stream = match timeout(
                        Duration::from_secs(STREAM_OPEN_TIMEOUT_SECONDS),
                        agent.client.stream_with_debug(request, debug_raw),
                    )
                    .await
                    {
                        Ok(Ok(s)) => s,
                        Ok(Err(err)) => {
                            error!("Stream request failed: {}", err);
                            let attempt = match register_self_correction_attempt(
                                &mut consecutive_self_corrections,
                                &err,
                                "API request",
                            ) {
                                Ok(attempt) => attempt,
                                Err(limit_err) => {
                                    let _ = tx.send(Err(limit_err)).await;
                                    return;
                                }
                            };
                            emit_debug(
                                &tx,
                                "retry",
                                format!(
                                    "API request failed; asking model to self-correct ({}/{}): {}",
                                    attempt, MAX_CONSECUTIVE_SELF_CORRECTIONS, err
                                ),
                            )
                            .await;
                            let error_msg = format!(
                                "The API rejected the previous request with an error: {}. \
                                This may be due to a malformed tool call or invalid message format. \
                                Please try again with a corrected approach.",
                                err
                            );
                            let _ = tx
                                .send(Ok(AgentEvent::TextDelta(format!(
                                    "\n\n*[Retrying after API error ({}/{})...]*\n\n",
                                    attempt, MAX_CONSECUTIVE_SELF_CORRECTIONS
                                ))))
                                .await;
                            messages.push(Message::user(error_msg));
                            continue;
                        }
                        Err(_) => {
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
                                &tx,
                                "error",
                                format!(
                                    "Provider stream did not open within {}s (request_body={} bytes)",
                                    STREAM_OPEN_TIMEOUT_SECONDS,
                                    request_body_bytes
                                ),
                            )
                            .await;
                            let _ = tx.send(Err(err)).await;
                            return;
                        }
                    };
                    emit_debug(&tx, "stream", "Provider stream opened successfully").await;

                    while let Some(event) = stream.next().await {
                        if cancel_flag.load(Ordering::SeqCst) {
                            let _ = tx
                                .send(Ok(AgentEvent::Cancelled {
                                    reason: "Cancelled by user".to_string(),
                                    messages: messages.clone(),
                                }))
                                .await;
                            return;
                        }

                        match event {
                            Ok(StreamEvent::TextDelta(text)) => {
                                if !text.is_empty() {
                                    saw_output = true;
                                    assistant_text.push_str(&text);
                                    let _ = tx.send(Ok(AgentEvent::TextDelta(text))).await;
                                }
                            }
                            Ok(StreamEvent::ReasoningDelta(reasoning)) => {
                                if !reasoning.is_empty() {
                                    saw_output = true;
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
                                saw_output = true;
                                info!("Tool call received: {} with args: {}", name, arguments);
                                emit_debug(
                                    &tx,
                                    "tool",
                                    format!("Model emitted tool call {}", name),
                                )
                                .await;
                                tool_calls.push(ToolCall::new(id, name, arguments));
                            }
                            Ok(StreamEvent::Raw(raw)) => {
                                if debug_raw {
                                    emit_debug(&tx, "raw", raw).await;
                                }
                            }
                            Ok(StreamEvent::Done) => {
                                info!(
                                    "Stream done - text: {} chars, tool_calls: {}, saw_output: {}",
                                    assistant_text.len(),
                                    tool_calls.len(),
                                    saw_output
                                );
                                emit_debug(
                                    &tx,
                                    "stream",
                                    format!(
                                        "Provider stream signaled done: text_chars={}, tool_calls={}, saw_output={}",
                                        assistant_text.len(),
                                        tool_calls.len(),
                                        saw_output
                                    ),
                                )
                                .await;
                                if saw_output {
                                    break;
                                }
                            }
                            Err(err) => {
                                error!("Stream error: {}", err);
                                emit_debug(&tx, "error", format!("Provider stream error: {}", err)).await;
                                stream_error = Some(err);
                                break;
                            }
                        }
                    }
                }

                // If stream errored, feed error back to the LLM to self-correct
                if let Some(err) = stream_error {
                    let attempt = match register_self_correction_attempt(
                        &mut consecutive_self_corrections,
                        &err,
                        "Streaming response",
                    ) {
                        Ok(attempt) => attempt,
                        Err(limit_err) => {
                            let _ = tx.send(Err(limit_err)).await;
                            return;
                        }
                    };
                    emit_debug(
                        &tx,
                        "retry",
                        format!(
                            "Streaming response failed; asking model to self-correct ({}/{}): {}",
                            attempt, MAX_CONSECUTIVE_SELF_CORRECTIONS, err
                        ),
                    )
                    .await;
                    let error_msg = format!(
                        "The API returned an error during streaming: {}. \
                        This may be due to a malformed tool call or response format issue. \
                        Please try again with a corrected approach.",
                        err
                    );
                    let _ = tx
                        .send(Ok(AgentEvent::TextDelta(format!(
                            "\n\n*[Retrying after stream error ({}/{})...]*\n\n",
                            attempt, MAX_CONSECUTIVE_SELF_CORRECTIONS
                        ))))
                        .await;
                    // Save any partial assistant text
                    if !assistant_text.is_empty() {
                        messages.push(Message::assistant_text(assistant_text.clone()));
                    }
                    messages.push(Message::user(error_msg));
                    continue;
                }

                consecutive_self_corrections = 0;

                if tool_calls.is_empty() {
                    if !assistant_text.is_empty() {
                        messages.push(Message::assistant_text(assistant_text.clone()));
                    }
                    emit_debug(
                        &tx,
                        "success",
                        format!("Agent completed without tool calls; final_text_chars={}", assistant_text.len()),
                    )
                    .await;
                    let _ = tx
                        .send(Ok(AgentEvent::Done {
                            final_text: assistant_text,
                            messages: messages.clone(),
                        }))
                        .await;
                    return;
                } else {
                    info!("Processing {} tool calls", tool_calls.len());
                    let content = if assistant_text.is_empty() {
                        None
                    } else {
                        Some(MessageContent::Plain(assistant_text.clone()))
                    };
                    messages.push(Message::assistant_with_tool_calls(
                        content,
                        tool_calls.clone(),
                    ));

                    for tool_call in tool_calls {
                        if cancel_flag.load(Ordering::SeqCst) {
                            let _ = tx
                                .send(Ok(AgentEvent::Cancelled {
                                    reason: "Cancelled by user".to_string(),
                                    messages: messages.clone(),
                                }))
                                .await;
                            return;
                        }

                        let name = tool_call.function.name.clone();
                        let input: Value = serde_json::from_str(&tool_call.function.arguments)
                            .unwrap_or_else(|_| {
                                Value::String(tool_call.function.arguments.clone())
                            });

                        info!("Executing tool: {} with input: {:?}", name, input);
                        emit_debug(&tx, "tool", format!("Executing tool {}", name)).await;
                        let _ = tx
                            .send(Ok(AgentEvent::ToolStart {
                                name: name.clone(),
                                input: input.clone(),
                            }))
                            .await;

                        let result = agent.execute_tool_with_policy(&name, input).await;

                        let (result_text, success) = match result {
                            Ok(output) => {
                                info!(
                                    "Tool {} succeeded: {} chars output",
                                    name,
                                    output.llm_output.len()
                                );
                                emit_debug(
                                    &tx,
                                    "tool",
                                    format!("Tool {} succeeded with {} chars of output", name, output.llm_output.len()),
                                )
                                .await;
                                (output.llm_output, true)
                            }
                            Err(err) => {
                                error!("Tool {} failed: {}", name, err);
                                emit_debug(&tx, "error", format!("Tool {} failed: {}", name, err)).await;
                                (format!("Error: {}", err), false)
                            }
                        };

                        messages.push(Message::tool_result(
                            tool_call.id.clone(),
                            result_text.clone(),
                        ));

                        let _ = tx
                            .send(Ok(AgentEvent::ToolResult {
                                name,
                                result: result_text,
                                success,
                            }))
                            .await;
                    }
                    emit_debug(&tx, "agent", "Tool execution phase complete; continuing agent loop").await;
                    info!("Tool execution complete, continuing to next iteration");
                }
            }

            let _ = tx
                .send(Err(anyhow!(
                    "Max iterations ({}) reached without completion",
                    agent.max_iterations
                )))
                .await;
        });

        Ok((ReceiverStream::new(rx), handle))
    }

    async fn execute_tool_with_policy(&self, name: &str, input: Value) -> Result<AgentToolOutput> {
        if name == "run_command" {
            let policy = self.tools.policy();
            if !policy.allow_command_tool {
                return Err(Error::new(SdkError::permission(
                    "run_command is disabled by policy",
                )));
            }

            if let Some(allowlist) = &policy.command_allowlist {
                let command = input
                    .get("command")
                    .and_then(|v| v.as_str())
                    .unwrap_or_default();
                let allowed = allowlist.iter().any(|prefix| command.starts_with(prefix));
                if !allowed {
                    return Err(Error::new(SdkError::permission(format!(
                        "Command blocked by allowlist policy: {}",
                        command
                    ))));
                }
            }

            let tool = self
                .tools
                .get(name)
                .ok_or_else(|| anyhow!("Tool '{}' not found", name))?;
            let timeout_duration = Duration::from_millis(policy.command_timeout_ms);
            return timeout(timeout_duration, tool.run(input))
                .await
                .map_err(|_| {
                    Error::new(SdkError::timeout(format!(
                        "Tool '{}' timed out after {}ms",
                        name, policy.command_timeout_ms
                    )))
                })?;
        }

        match self.tools.get(name) {
            Some(tool) => tool.run(input).await,
            None => Err(anyhow!("Tool '{}' not found", name)),
        }
    }

    fn build_request(&self, mut messages: Vec<Message>, stream: bool) -> ChatRequest {
        if let Some(system_prompt) = &self.system_prompt {
            messages.insert(0, Message::system(system_prompt.clone()));
        }

        ChatRequest {
            model: self.client.model().to_string(),
            messages,
            tools: if self.tools.is_empty() {
                None
            } else {
                Some(self.tools.definitions())
            },
            tool_choice: None,
            stream,
            max_tokens: self.max_tokens,
            temperature: self.temperature,
        }
    }
}

fn register_self_correction_attempt(
    consecutive_attempts: &mut usize,
    err: &Error,
    phase: &str,
) -> Result<usize> {
    if !should_attempt_self_correction(err) {
        return Err(anyhow!("{} failed: {}", phase, err));
    }

    *consecutive_attempts += 1;

    if *consecutive_attempts > MAX_CONSECUTIVE_SELF_CORRECTIONS {
        return Err(anyhow!(
            "{} failed after {} self-correction attempts: {}",
            phase,
            MAX_CONSECUTIVE_SELF_CORRECTIONS,
            err
        ));
    }

    Ok(*consecutive_attempts)
}

fn messages_include_inline_images(messages: &[Message]) -> bool {
    messages.iter().any(|message| {
        let has_inline = match message.content.as_ref() {
            Some(MessageContent::Multipart(parts)) => {
                parts.iter().any(|part| matches!(part, MessagePart::Image { .. }))
            }
            _ => false,
        };
        has_inline
    })
}

async fn emit_debug(
    tx: &mpsc::Sender<Result<AgentEvent>>,
    kind: &str,
    message: impl Into<String>,
) {
    let _ = tx
        .send(Ok(AgentEvent::Debug {
            kind: kind.to_string(),
            message: message.into(),
        }))
        .await;
}

fn should_attempt_self_correction(err: &Error) -> bool {
    let Some(sdk_err) = err.downcast_ref::<SdkError>() else {
        return false;
    };

    matches!(sdk_err.category, ErrorCategory::Stream)
        || (matches!(sdk_err.category, ErrorCategory::Provider)
            && matches!(sdk_err.status, Some(400 | 422)))
}

#[cfg(test)]
mod tests {
    use super::{
        register_self_correction_attempt, should_attempt_self_correction,
        MAX_CONSECUTIVE_SELF_CORRECTIONS,
    };
    use crate::sdk::core::SdkError;
    use anyhow::Error;

    #[test]
    fn self_correction_is_allowed_for_provider_400_errors() {
        let err = Error::new(SdkError::provider("bad request").with_status(400));
        assert!(should_attempt_self_correction(&err));
    }

    #[test]
    fn self_correction_is_not_allowed_for_retryable_provider_errors() {
        let err = Error::new(SdkError::provider("rate limited").with_status(429));
        assert!(!should_attempt_self_correction(&err));
    }

    #[test]
    fn self_correction_is_allowed_for_stream_errors() {
        let err = Error::new(SdkError::stream("malformed stream chunk"));
        assert!(should_attempt_self_correction(&err));
    }

    #[test]
    fn self_correction_limit_is_enforced() {
        let err = Error::new(SdkError::provider("bad request").with_status(400));
        let mut attempts = 0;

        for _ in 0..MAX_CONSECUTIVE_SELF_CORRECTIONS {
            assert!(register_self_correction_attempt(&mut attempts, &err, "API request").is_ok());
        }
        assert!(register_self_correction_attempt(&mut attempts, &err, "API request").is_err());
    }
}
