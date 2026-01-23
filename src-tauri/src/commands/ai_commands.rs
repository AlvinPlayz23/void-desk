//! AI Commands for Tauri
//!
//! This module provides Tauri commands for AI interactions,
//! using adk-rust for agent execution with streaming responses.

use super::ai_service::{self, AIService};
use adk_core::Part;
use adk_runner::{Runner, RunnerConfig};
use adk_session::{CreateRequest, InMemorySessionService, SessionService};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
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
pub struct ToolOperation {
    pub operation: String, // e.g., "read", "write", "list", "command"
    pub target: String,    // e.g., file path or command
    pub status: String,    // e.g., "started", "completed", "failed"
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AIResponseChunk {
    pub content: Option<String>,
    pub tool_call: Option<String>,
    pub tool_operation: Option<ToolOperation>,
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

    // Try to create an agent
    let agent = AIService::create_agent(api_key, &base_url, model_id, None)?;

    // Create a mock session service just for testing
    let session_service = Arc::new(InMemorySessionService::new());
    let session = session_service
        .create(CreateRequest {
            app_name: "voidesk_test".to_string(),
            user_id: "test_user".to_string(),
            session_id: None,
            state: HashMap::new(),
        })
        .await
        .map_err(|e| format!("Failed to create test session: {}", e))?;

    // Create a runner
    let runner = Runner::new(RunnerConfig {
        app_name: "voidesk_test".to_string(),
        agent: Arc::new(agent),
        session_service,
        artifact_service: None,
        memory_service: None,
        run_config: None,
    })
    .map_err(|e| format!("Failed to create test runner: {}", e))?;

    // Create a simple test message
    let test_content = ai_service::create_user_content("Say 'Connection Successful'");

    // Run the agent (non-streaming for test)
    let mut stream = runner
        .run(
            "test_user".to_string(),
            session.id().to_string(),
            test_content,
        )
        .await
        .map_err(|e| format!("Connection test failed: {}", e))?;

    // Get the first chunk to verify it works
    if let Some(event) = stream.next().await {
        match event {
            Ok(_) => Ok("Connection successful! API is responsive.".to_string()),
            Err(e) => Err(format!("API error: {}", e)),
        }
    } else {
        Err("No response from API".to_string())
    }
}

/// Stream AI responses using adk-rust
#[tauri::command]
pub async fn ask_ai_stream(
    message: String,
    api_key: String,
    base_url: String,
    model_id: String,
    active_path: Option<String>,
    on_event: Channel<AIResponseChunk>,
) -> Result<(), String> {
    let api_key = api_key.trim();
    let model_id = model_id.trim();

    if api_key.is_empty() {
        on_event
            .send(AIResponseChunk {
                content: None,
                tool_call: None,
                tool_operation: None,
                error: Some("API key is required".to_string()),
                done: true,
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Get the AI service
    let service = get_ai_service().await;

    // Create the agent with active_path
    let agent = match AIService::create_agent(api_key, &base_url, model_id, active_path.as_deref())
    {
        Ok(a) => a,
        Err(e) => {
            on_event
                .send(AIResponseChunk {
                    content: None,
                    tool_call: None,
                    tool_operation: None,
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
                    tool_operation: None,
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
                    tool_operation: None,
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
                    tool_operation: None,
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
                                            tool_operation: None,
                                            error: None,
                                            done: false,
                                        })
                                        .map_err(|e| e.to_string())?;
                                }
                            }
                            Part::FunctionCall { name, args, .. } => {
                                // Parse tool operation details
                                let (operation, target) = match name.as_str() {
                                    "read_file" => (
                                        "Reading".to_string(),
                                        args.get("path")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string(),
                                    ),
                                    "write_file" | "create_file" => (
                                        "Writing".to_string(),
                                        args.get("path")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string(),
                                    ),
                                    "list_directory" => (
                                        "Listing".to_string(),
                                        args.get("path")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string(),
                                    ),
                                    "run_command" => (
                                        "Running".to_string(),
                                        args.get("command")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string(),
                                    ),
                                    _ => (name.clone(), "unknown".to_string()),
                                };

                                on_event
                                    .send(AIResponseChunk {
                                        content: None,
                                        tool_call: Some(format!(
                                            "Calling tool: {} with args: {}",
                                            name,
                                            serde_json::to_string(&args).unwrap_or_default()
                                        )),
                                        tool_operation: Some(ToolOperation {
                                            operation,
                                            target,
                                            status: "started".to_string(),
                                        }),
                                        error: None,
                                        done: false,
                                    })
                                    .map_err(|e| e.to_string())?;
                            }
                            Part::FunctionResponse {
                                function_response,
                                id: _,
                            } => {
                                // Parse result to extract success status
                                let success = function_response
                                    .response
                                    .get("success")
                                    .and_then(|v| v.as_bool())
                                    .unwrap_or(true);

                                let target = function_response
                                    .response
                                    .get("path")
                                    .and_then(|v| v.as_str())
                                    .unwrap_or("");

                                let operation = match function_response.name.as_str() {
                                    "read_file" => "Read",
                                    "write_file" => "Created",
                                    "list_directory" => "Listed",
                                    "run_command" => "Executed",
                                    _ => "Completed",
                                };

                                on_event
                                    .send(AIResponseChunk {
                                        content: None,
                                        tool_call: Some(format!(
                                            "Tool {} returned: {}",
                                            function_response.name,
                                            serde_json::to_string(&function_response.response)
                                                .unwrap_or_default()
                                        )),
                                        tool_operation: Some(ToolOperation {
                                            operation: operation.to_string(),
                                            target: target.to_string(),
                                            status: if success {
                                                "completed".to_string()
                                            } else {
                                                "failed".to_string()
                                            },
                                        }),
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
                        tool_operation: None,
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
            tool_operation: None,
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
