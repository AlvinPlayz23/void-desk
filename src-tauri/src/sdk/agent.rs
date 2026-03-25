//! Agent module - Orchestrates provider + tools + session

mod runtime;

use anyhow::{anyhow, Error, Result};
use serde_json::Value;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc,
};
use tokio::sync::mpsc;
use tokio::time::{timeout, Duration};
use tokio_stream::wrappers::ReceiverStream;
use tracing::{error, info};

use crate::sdk::core::{
    AgentEvent, CancelledEvent, ChatRequest, DebugEvent, ErrorCategory, InlineImageAttachment,
    Message, MessageContent, MessagePart, SdkError,
};
use crate::sdk::provider::Provider;
use crate::sdk::tools::{AgentTool, AgentToolOutput, ToolPolicy, ToolRegistry};

use self::runtime::{
    execute_tool_round, log_request_debug, run_multimodal_request, run_streaming_request,
    RuntimeControl,
};

const DEFAULT_MAX_ITERATIONS: usize = 80;
const MAX_CONSECUTIVE_SELF_CORRECTIONS: usize = 3;
const STREAM_OPEN_TIMEOUT_SECONDS: u64 = 90;
const MULTIMODAL_COMPLETION_TIMEOUT_SECONDS: u64 = 90;
const CANCELLATION_POLL_INTERVAL_MS: u64 = 50;

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
    provider: Arc<dyn Provider>,
    tools: ToolRegistry,
    system_prompt: Option<String>,
    max_iterations: usize,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

pub struct AgentBuilder {
    provider: Arc<dyn Provider>,
    tools: Vec<Arc<dyn AgentTool>>,
    tool_policy: ToolPolicy,
    system_prompt: Option<String>,
    max_iterations: usize,
    max_tokens: Option<u32>,
    temperature: Option<f32>,
}

impl Agent {
    pub fn builder(provider: Arc<dyn Provider>) -> AgentBuilder {
        AgentBuilder {
            provider,
            tools: Vec::new(),
            tool_policy: ToolPolicy::default(),
            system_prompt: None,
            max_iterations: DEFAULT_MAX_ITERATIONS,
            max_tokens: None,
            temperature: Some(0.2),
        }
    }

    pub fn new(provider: Arc<dyn Provider>) -> Self {
        Self::builder(provider).build()
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
            let response = match self.provider.complete(request).await {
                Ok(response) => response,
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
                Some(choice) => choice,
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
                messages.push(Message::user_multipart(
                    user_message.clone(),
                    image_attachments,
                ));
            }

            if let Some(last) = messages.last() {
                let content_desc = match &last.content {
                    Some(MessageContent::Multipart(parts)) => {
                        let img_count = parts
                            .iter()
                            .filter(|part| matches!(part, MessagePart::Image { .. }))
                            .count();
                        format!("Multipart with {} parts, {} images", parts.len(), img_count)
                    }
                    Some(MessageContent::Plain(text)) => {
                        format!("Plain text ({} chars)", text.len())
                    }
                    None => "None".to_string(),
                };
                emit_debug(
                    &tx,
                    "agent",
                    format!("Created user message: {}", content_desc),
                )
                .await;
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
                    let _ = tx.send(Ok(cancelled_event(&messages))).await;
                    return;
                }

                info!(
                    "Agent iteration {} - {} messages in history",
                    iteration,
                    messages.len()
                );

                let contains_inline_images = messages_include_inline_images(&messages);
                let request = agent.build_request(messages.clone(), !contains_inline_images);
                log_request_debug(&tx, &messages, &request, iteration, contains_inline_images)
                    .await;

                let request_body_bytes = serde_json::to_vec(&request)
                    .map(|body| body.len())
                    .unwrap_or(0);

                let turn_result = if contains_inline_images {
                    run_multimodal_request(
                        &agent,
                        &tx,
                        cancel_flag.clone(),
                        &messages,
                        request,
                        request_body_bytes,
                        iteration,
                    )
                    .await
                } else {
                    run_streaming_request(
                        &agent,
                        &tx,
                        cancel_flag.clone(),
                        &messages,
                        request,
                        request_body_bytes,
                        debug_raw,
                        iteration,
                    )
                    .await
                };

                let mut turn = match turn_result {
                    Ok(RuntimeControl::Completed(turn)) => turn,
                    Ok(RuntimeControl::Cancelled) => return,
                    Err(err) => {
                        error!("Provider request failed: {}", err);
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
                };

                turn.flush_pending_think(&tx).await;

                if let Some(err) = turn.stream_error.take() {
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
                    if !turn.assistant_text.is_empty() {
                        messages.push(Message::assistant_text(turn.assistant_text.clone()));
                    }
                    messages.push(Message::user(error_msg));
                    continue;
                }

                consecutive_self_corrections = 0;

                if turn.apply_reasoning_policy(agent.tools.policy().allow_tools_in_reasoning) {
                    emit_debug(
                        &tx,
                        "policy",
                        "Tool calls suppressed: allow_tools_in_reasoning=false",
                    )
                    .await;
                }

                if turn.tool_calls.is_empty() {
                    if !turn.assistant_text.is_empty() {
                        messages.push(Message::assistant_text(turn.assistant_text.clone()));
                    }
                    emit_debug(
                        &tx,
                        "success",
                        format!(
                            "Agent completed without tool calls; final_text_chars={}",
                            turn.assistant_text.len()
                        ),
                    )
                    .await;
                    let _ = tx.send(Ok(turn.into_done_event(messages.clone()))).await;
                    return;
                }

                match execute_tool_round(
                    &agent,
                    &tx,
                    cancel_flag.clone(),
                    &mut messages,
                    &turn.assistant_text,
                    turn.tool_calls,
                )
                .await
                {
                    Ok(RuntimeControl::Completed(())) => {}
                    Ok(RuntimeControl::Cancelled) => return,
                    Err(err) => {
                        let _ = tx.send(Err(err)).await;
                        return;
                    }
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
                    .and_then(|value| value.as_str())
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
            model: self.provider.model().to_string(),
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

impl AgentBuilder {
    pub fn with_tool(mut self, tool: Arc<dyn AgentTool>) -> Self {
        self.tools.push(tool);
        self
    }

    pub fn with_tools(mut self, tools: impl IntoIterator<Item = Arc<dyn AgentTool>>) -> Self {
        self.tools.extend(tools);
        self
    }

    pub fn with_tool_policy(mut self, policy: ToolPolicy) -> Self {
        self.tool_policy = policy;
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

    pub fn build(self) -> Agent {
        let mut registry = ToolRegistry::new();
        registry.set_policy(self.tool_policy);
        for tool in self.tools {
            registry.register(tool);
        }

        Agent {
            provider: self.provider,
            tools: registry,
            system_prompt: self.system_prompt,
            max_iterations: self.max_iterations,
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
    messages
        .iter()
        .any(|message| match message.content.as_ref() {
            Some(MessageContent::Multipart(parts)) => parts
                .iter()
                .any(|part| matches!(part, MessagePart::Image { .. })),
            _ => false,
        })
}

async fn wait_for_cancellation(cancel_flag: Arc<AtomicBool>) {
    while !cancel_flag.load(Ordering::SeqCst) {
        tokio::time::sleep(Duration::from_millis(CANCELLATION_POLL_INTERVAL_MS)).await;
    }
}

fn cancelled_event(messages: &[Message]) -> AgentEvent {
    AgentEvent::Cancelled(CancelledEvent {
        reason: "Cancelled by user".to_string(),
        messages: messages.to_vec(),
    })
}

async fn emit_debug(tx: &mpsc::Sender<Result<AgentEvent>>, kind: &str, message: impl Into<String>) {
    let _ = tx
        .send(Ok(AgentEvent::Debug(DebugEvent {
            kind: kind.to_string(),
            message: message.into(),
        })))
        .await;
}

fn safe_emit_len(buf: &str, tag: &str) -> usize {
    let buf_bytes = buf.as_bytes();
    let tag_bytes = tag.as_bytes();
    let max_overlap = tag.len().min(buf.len());
    for overlap in (1..=max_overlap).rev() {
        if buf_bytes[buf.len() - overlap..] == tag_bytes[..overlap] {
            return buf.len() - overlap;
        }
    }
    buf.len()
}

fn split_think_tags(text: &str, in_think: &mut bool, buf: &mut String) -> Vec<AgentEvent> {
    buf.push_str(text);
    let mut events = Vec::new();

    loop {
        if *in_think {
            if let Some(pos) = buf.find("</think>") {
                let chunk = buf[..pos].to_string();
                if !chunk.is_empty() {
                    events.push(AgentEvent::ReasoningDelta(chunk));
                }
                *buf = buf[pos + "</think>".len()..].to_string();
                *in_think = false;
            } else {
                let safe = safe_emit_len(buf, "</think>");
                if safe > 0 {
                    events.push(AgentEvent::ReasoningDelta(buf[..safe].to_string()));
                    *buf = buf[safe..].to_string();
                }
                break;
            }
        } else if let Some(pos) = buf.find("<think>") {
            let before = buf[..pos].to_string();
            if !before.is_empty() {
                events.push(AgentEvent::TextDelta(before));
            }
            *buf = buf[pos + "<think>".len()..].to_string();
            *in_think = true;
        } else {
            let safe = safe_emit_len(buf, "<think>");
            if safe > 0 {
                events.push(AgentEvent::TextDelta(buf[..safe].to_string()));
                *buf = buf[safe..].to_string();
            }
            break;
        }
    }

    events
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
