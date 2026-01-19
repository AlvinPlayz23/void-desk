//! AI Commands for Tauri
//!
//! This module provides Tauri commands for AI interactions,
//! using adk-rust for agent execution with streaming responses.

use super::ai_service::{self, AIService};
use adk_core::Part;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::OnceCell;

/// Global AI service instance (lazy initialized)
static AI_SERVICE: OnceCell<Arc<AIService>> = OnceCell::const_new();

/// Get or initialize the global AI service
async fn get_ai_service() -> Arc<AIService> {
    AI_SERVICE
        .get_or_init(|| async { Arc::new(AIService::new()) })
        .await
        .clone()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AIResponseChunk {
    pub content: Option<String>,
    pub tool_call: Option<String>,
    pub error: Option<String>,
    pub done: bool,
}

/// Test the AI connection with the provided credentials
#[tauri::command]
pub async fn test_ai_connection(
    api_key: String,
    base_url: String,
    model_id: String,
) -> Result<String, String> {
    let api_key = api_key.trim();
    let model_id = model_id.trim();

    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    if model_id.is_empty() {
        return Err("Model ID is required".to_string());
    }

    // Try to create an agent - this validates the configuration
    let _agent = AIService::create_agent(api_key, &base_url, model_id)?;

    // If we get here, the configuration is valid
    // Note: We can't actually test the connection without making a request,
    // but creating the agent validates the configuration
    Ok("Configuration valid! Agent created successfully.".to_string())
}

/// Stream AI responses using adk-rust
#[tauri::command]
pub async fn ask_ai_stream(
    message: String,
    api_key: String,
    base_url: String,
    model_id: String,
    on_event: Channel<AIResponseChunk>,
) -> Result<(), String> {
    let api_key = api_key.trim();
    let model_id = model_id.trim();

    if api_key.is_empty() {
        on_event
            .send(AIResponseChunk {
                content: None,
                tool_call: None,
                error: Some("API key is required".to_string()),
                done: true,
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Get the AI service
    let service = get_ai_service().await;

    // Create the agent
    let agent = match AIService::create_agent(api_key, &base_url, model_id) {
        Ok(a) => a,
        Err(e) => {
            on_event
                .send(AIResponseChunk {
                    content: None,
                    tool_call: None,
                    error: Some(format!("Failed to create agent: {}", e)),
                    done: true,
                })
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // Get or create session
    let user_id = "default_user";
    let app_name = "voidesk";

    let session_id = match service.get_or_create_session(user_id, app_name).await {
        Ok(id) => id,
        Err(e) => {
            on_event
                .send(AIResponseChunk {
                    content: None,
                    tool_call: None,
                    error: Some(format!("Failed to create session: {}", e)),
                    done: true,
                })
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // Create runner
    let runner = match service.create_runner(agent, app_name) {
        Ok(r) => r,
        Err(e) => {
            on_event
                .send(AIResponseChunk {
                    content: None,
                    tool_call: None,
                    error: Some(format!("Failed to create runner: {}", e)),
                    done: true,
                })
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // Create user content
    let user_content = ai_service::create_user_content(&message);

    // Run the agent and stream responses
    let mut stream = match runner
        .run(user_id.to_string(), session_id, user_content)
        .await
    {
        Ok(s) => s,
        Err(e) => {
            on_event
                .send(AIResponseChunk {
                    content: None,
                    tool_call: None,
                    error: Some(format!("Failed to run agent: {}", e)),
                    done: true,
                })
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // Process the stream
    while let Some(event) = stream.next().await {
        match event {
            Ok(e) => {
                // Check for content in the LLM response
                if let Some(content) = e.llm_response.content {
                    for part in content.parts {
                        match part {
                            Part::Text { text } => {
                                if !text.is_empty() {
                                    on_event
                                        .send(AIResponseChunk {
                                            content: Some(text),
                                            tool_call: None,
                                            error: None,
                                            done: false,
                                        })
                                        .map_err(|e| e.to_string())?;
                                }
                            }
                            Part::FunctionCall { name, args, .. } => {
                                // Notify about tool calls
                                on_event
                                    .send(AIResponseChunk {
                                        content: None,
                                        tool_call: Some(format!(
                                            "Calling tool: {} with args: {}",
                                            name,
                                            serde_json::to_string(&args).unwrap_or_default()
                                        )),
                                        error: None,
                                        done: false,
                                    })
                                    .map_err(|e| e.to_string())?;
                            }
                            Part::FunctionResponse { name, response, .. } => {
                                // Notify about tool results
                                on_event
                                    .send(AIResponseChunk {
                                        content: None,
                                        tool_call: Some(format!(
                                            "Tool {} returned: {}",
                                            name,
                                            serde_json::to_string(&response).unwrap_or_default()
                                        )),
                                        error: None,
                                        done: false,
                                    })
                                    .map_err(|e| e.to_string())?;
                            }
                            _ => {}
                        }
                    }
                }
            }
            Err(e) => {
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        error: Some(format!("Stream error: {}", e)),
                        done: true,
                    })
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    // Stream complete
    on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            error: None,
            done: true,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Reset the conversation (clear session)
#[tauri::command]
pub async fn reset_ai_conversation() -> Result<(), String> {
    let service = get_ai_service().await;
    service.reset_session("default_user").await;
    Ok(())
}
