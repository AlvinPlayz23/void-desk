//! Agent module - Orchestrates provider + tools + session

use anyhow::{anyhow, Result};
use futures::StreamExt;
use serde_json::Value;
use std::sync::Arc;
use tokio::sync::mpsc;
use tokio_stream::wrappers::ReceiverStream;
use tracing::{debug, error, info};

use crate::sdk::client::AIClient;
use crate::sdk::core::{ChatRequest, Message, MessageContent, StreamEvent, ToolCall};
use crate::sdk::tools::ToolRegistry;

/// Events emitted by the agent during execution
#[derive(Debug, Clone)]
pub enum AgentEvent {
    TextDelta(String),
    ToolStart { name: String, input: Value },
    ToolResult { name: String, result: String, success: bool },
    Debug(String),
    Done { final_text: String, messages: Vec<Message> },
}

/// Result of agent execution
#[derive(Debug, Clone)]
pub struct AgentResult {
    pub text: String,
    pub messages: Vec<Message>,
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
            max_iterations: 10,
            max_tokens: None,
            temperature: Some(0.2),
        }
    }

    pub fn with_tool(mut self, tool: Arc<dyn crate::sdk::tools::AgentTool>) -> Self {
        self.tools.register(tool);
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
        messages.push(Message::user(user_message));

        for _ in 0..self.max_iterations {
            let request = self.build_request(messages.clone(), false);
            let response = self.client.complete(request).await?;

            let choice = response
                .choices
                .get(0)
                .ok_or_else(|| anyhow!("No choices returned from model"))?;

            let assistant_message = choice.message.clone();
            let text = assistant_message.text();
            messages.push(assistant_message.clone());

            if let Some(tool_calls) = &assistant_message.tool_calls {
                for tool_call in tool_calls {
                    let name = &tool_call.function.name;
                    let input: Value = serde_json::from_str(&tool_call.function.arguments)
                        .unwrap_or_else(|_| Value::String(tool_call.function.arguments.clone()));

                    let result = match self.tools.get(name) {
                        Some(tool) => tool.run(input).await,
                        None => Err(anyhow!("Tool '{}' not found", name)),
                    };

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
        self.run_streaming_with_debug(user_message, history, false).await
    }

    pub async fn run_streaming_with_debug(
        &self,
        user_message: String,
        history: Vec<Message>,
        debug_raw: bool,
    ) -> Result<impl futures::Stream<Item = Result<AgentEvent>>> {
        let agent = self.clone();
        let (tx, rx) = mpsc::channel(64);

        tokio::spawn(async move {
            let mut messages = history;
            messages.push(Message::user(user_message.clone()));
            info!("Agent starting with message: {}", user_message);

            for iteration in 0..agent.max_iterations {
                info!("Agent iteration {} - {} messages in history", iteration, messages.len());
                let request = agent.build_request(messages.clone(), true);
                debug!("Request: {:?}", serde_json::to_string(&request));

                let mut stream = match agent.client.stream_with_debug(request, debug_raw).await {
                    Ok(s) => s,
                    Err(err) => {
                        error!("Stream request failed: {}", err);
                        let _ = tx.send(Err(err)).await;
                        return;
                    }
                };

                let mut assistant_text = String::new();
                let mut tool_calls: Vec<ToolCall> = Vec::new();
                let mut saw_output = false;

                while let Some(event) = stream.next().await {
                    match event {
                        Ok(StreamEvent::TextDelta(text)) => {
                            if !text.is_empty() {
                                saw_output = true;
                                assistant_text.push_str(&text);
                                let _ = tx.send(Ok(AgentEvent::TextDelta(text))).await;
                            }
                        }
                        Ok(StreamEvent::ToolCall { id, name, arguments }) => {
                            saw_output = true;
                            info!("Tool call received: {} with args: {}", name, arguments);
                            tool_calls.push(ToolCall::new(id, name, arguments));
                        }
                        Ok(StreamEvent::Raw(raw)) => {
                            if debug_raw {
                                let _ = tx.send(Ok(AgentEvent::Debug(raw))).await;
                            }
                        }
                        Ok(StreamEvent::Done) => {
                            info!(
                                "Stream done - text: {} chars, tool_calls: {}, saw_output: {}",
                                assistant_text.len(),
                                tool_calls.len(),
                                saw_output
                            );
                            if saw_output {
                                break;
                            }
                        }
                        Err(err) => {
                            error!("Stream error: {}", err);
                            let _ = tx.send(Err(err)).await;
                            return;
                        }
                    }
                }

                if tool_calls.is_empty() {
                    if !assistant_text.is_empty() {
                        messages.push(Message::assistant_text(assistant_text.clone()));
                    }
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
                    messages.push(Message::assistant_with_tool_calls(content, tool_calls.clone()));

                    for tool_call in tool_calls {
                        let name = tool_call.function.name.clone();
                        let input: Value = serde_json::from_str(&tool_call.function.arguments)
                            .unwrap_or_else(|_| Value::String(tool_call.function.arguments.clone()));

                        info!("Executing tool: {} with input: {:?}", name, input);
                        let _ = tx
                            .send(Ok(AgentEvent::ToolStart {
                                name: name.clone(),
                                input: input.clone(),
                            }))
                            .await;

                        let result = match agent.tools.get(&name) {
                            Some(tool) => tool.run(input).await,
                            None => {
                                error!("Tool '{}' not found in registry", name);
                                Err(anyhow!("Tool '{}' not found", name))
                            }
                        };

                        let (result_text, success) = match result {
                            Ok(output) => {
                                info!(
                                    "Tool {} succeeded: {} chars output",
                                    name,
                                    output.llm_output.len()
                                );
                                (output.llm_output, true)
                            }
                            Err(err) => {
                                error!("Tool {} failed: {}", name, err);
                                (format!("Error: {}", err), false)
                            }
                        };

                        messages.push(Message::tool_result(tool_call.id.clone(), result_text.clone()));

                        let _ = tx
                            .send(Ok(AgentEvent::ToolResult {
                                name,
                                result: result_text,
                                success,
                            }))
                            .await;
                    }
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

        Ok(ReceiverStream::new(rx))
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
