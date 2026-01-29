//! AI Commands for Tauri
//!
//! This module provides Tauri commands for AI interactions,
//! using adk-rust for agent execution with streaming responses.

use super::ai_service::{self, AIService};
use adk_core::Part;
use adk_runner::{Runner, RunnerConfig};
use adk_session::{CreateRequest, DeleteRequest, ListRequest, InMemorySessionService, SessionService};
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::OnceCell;

/// Global AI service instance (lazy initialized)
static AI_SERVICE: OnceCell<Arc<AIService>> = OnceCell::const_new();

/// Global session service instance for chat session management
static CHAT_SESSIONS: OnceCell<Arc<InMemorySessionService>> = OnceCell::const_new();

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
            tracing::error!("Failed to create agent: {}", e);
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
            tracing::error!("Failed to create session: {}", e);
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
            tracing::error!("Failed to create runner: {}", e);
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
            tracing::error!("Failed to run agent: {}", e);
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
                                    tracing::info!("stream text chunk size={}", text.len());
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
                                tracing::info!("tool call: {} args={}", name, args);
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
                tracing::error!("Stream error: {}", e);
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
    tracing::info!("Stream complete");
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct InlineCompletionChunk {
    pub text: String,
    pub done: bool,
    pub error: Option<String>,
}

/// Get inline AI completion for code
#[tauri::command]
pub async fn get_inline_completion(
    content: String,
    cursor_pos: usize,
    file_path: String,
    language: String,
    api_key: String,
    base_url: String,
    model_id: String,
    on_event: Channel<InlineCompletionChunk>,
) -> Result<(), String> {
    let api_key = api_key.trim();
    let model_id = model_id.trim();

    if api_key.is_empty() {
        on_event
            .send(InlineCompletionChunk {
                text: String::new(),
                done: true,
                error: Some("API key is required".to_string()),
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    // Build context: content before cursor and content after
    let before = if cursor_pos <= content.len() {
        &content[..cursor_pos]
    } else {
        &content
    };
    let after = if cursor_pos < content.len() {
        &content[cursor_pos..]
    } else {
        ""
    };

    // Create a specialized completion prompt
    let prompt = format!(
        r#"You are an inline code completion assistant. Generate ONLY the code that should be inserted at the cursor position. Do not include explanations, markdown, or code blocks.

Language: {language}
File: {file_path}

Code before cursor:
```
{before}
```

Code after cursor:
```
{after}
```

Generate a short, contextually appropriate completion (1-3 lines max). Output ONLY the raw code to insert, nothing else."#,
        language = language,
        file_path = file_path,
        before = before,
        after = after
    );

    // Create a lightweight agent without tools for completions
    let api_base = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
        base_url.trim_end_matches('/').to_string()
    } else {
        format!("{}/v1", base_url.trim_end_matches('/'))
    };

    let model = match adk_model::openai::OpenAIClient::compatible(api_key, &api_base, model_id) {
        Ok(m) => m,
        Err(e) => {
            on_event
                .send(InlineCompletionChunk {
                    text: String::new(),
                    done: true,
                    error: Some(format!("Failed to create model: {}", e)),
                })
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    let agent = match adk_agent::LlmAgentBuilder::new("inline_completion")
        .instruction("You are an inline code completion assistant. Output ONLY raw code, no markdown, no explanations.")
        .model(Arc::new(model))
        .build()
    {
        Ok(a) => a,
        Err(e) => {
            on_event
                .send(InlineCompletionChunk {
                    text: String::new(),
                    done: true,
                    error: Some(format!("Failed to create agent: {}", e)),
                })
                .map_err(|e| e.to_string())?;
            return Ok(());
        }
    };

    // Create ephemeral session for this completion
    let session_service = Arc::new(InMemorySessionService::new());
    let session = session_service
        .create(CreateRequest {
            app_name: "voidesk_completion".to_string(),
            user_id: "completion_user".to_string(),
            session_id: None,
            state: HashMap::new(),
        })
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    let runner = Runner::new(RunnerConfig {
        app_name: "voidesk_completion".to_string(),
        agent: Arc::new(agent),
        session_service,
        artifact_service: None,
        memory_service: None,
        run_config: None,
    })
    .map_err(|e| format!("Failed to create runner: {}", e))?;

    let user_content = ai_service::create_user_content(&prompt);

    let mut stream = runner
        .run(
            "completion_user".to_string(),
            session.id().to_string(),
            user_content,
        )
        .await
        .map_err(|e| format!("Failed to run agent: {}", e))?;

    while let Some(event) = stream.next().await {
        match event {
            Ok(e) => {
                if let Some(content) = e.llm_response.content {
                    for part in content.parts {
                        if let Part::Text { text } = part {
                            if !text.is_empty() {
                                on_event
                                    .send(InlineCompletionChunk {
                                        text,
                                        done: false,
                                        error: None,
                                    })
                                    .map_err(|e| e.to_string())?;
                            }
                        }
                    }
                }
            }
            Err(e) => {
                on_event
                    .send(InlineCompletionChunk {
                        text: String::new(),
                        done: true,
                        error: Some(format!("Stream error: {}", e)),
                    })
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    on_event
        .send(InlineCompletionChunk {
            text: String::new(),
            done: true,
            error: None,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

/// Get or initialize the global session service
async fn get_chat_sessions() -> Arc<InMemorySessionService> {
    CHAT_SESSIONS
        .get_or_init(|| async { Arc::new(InMemorySessionService::new()) })
        .await
        .clone()
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionMetadata {
    pub id: String,
    pub created_at: u64,
    pub last_updated: u64,
    pub name: String,
    pub message_count: usize,
}

/// Create a new chat session
#[tauri::command]
pub async fn create_chat_session(_name: String) -> Result<String, String> {
    let sessions = get_chat_sessions().await;
    let mut state = HashMap::new();
    state.insert("name".to_string(), _name.into());
    
    let session = sessions
        .create(CreateRequest {
            app_name: "voidesk".to_string(),
            user_id: "default_user".to_string(),
            session_id: None,
            state,
        })
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    Ok(session.id().to_string())
}

/// List all chat sessions with metadata
#[tauri::command]
pub async fn list_chat_sessions() -> Result<Vec<SessionMetadata>, String> {
    let sessions = get_chat_sessions().await;
    let session_list = sessions
        .list(ListRequest {
            app_name: "voidesk".to_string(),
            user_id: "default_user".to_string(),
        })
        .await
        .map_err(|e| format!("Failed to list sessions: {}", e))?;

    let metadata = session_list
        .into_iter()
        .filter_map(|session| {
            let state = session.state();
            let name = if let Some(serde_json::Value::String(n)) = state.get("name") {
                n.clone()
            } else {
                "Untitled".to_string()
            };
            
            Some(SessionMetadata {
                id: session.id().to_string(),
                created_at: 0, // adk-session doesn't expose timestamps easily
                last_updated: 0,
                name,
                message_count: 0,
            })
        })
        .collect();

    Ok(metadata)
}

/// Delete a chat session
#[tauri::command]
pub async fn delete_chat_session(session_id: String) -> Result<(), String> {
    let sessions = get_chat_sessions().await;
    sessions
        .delete(DeleteRequest {
            app_name: "voidesk".to_string(),
            user_id: "default_user".to_string(),
            session_id,
        })
        .await
        .map_err(|e| format!("Failed to delete session: {}", e))
}

/// Update session name in state (uses GetRequest to fetch, then updates internally)
#[tauri::command]
pub async fn rename_chat_session(session_id: String, name: String) -> Result<(), String> {
    // For now, just store the name in client-side state
    // adk-session doesn't provide an update method, so state is managed on the client
    let _ = (session_id, name);
    Ok(())
}

/// Update ask_ai_stream to accept session_id parameter
#[tauri::command]
pub async fn ask_ai_stream_with_session(
    session_id: String,
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
            tracing::error!("Failed to create agent: {}", e);
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

    // Validate or create session for this AI service
    let user_id = "default_user";
    let app_name = "voidesk";
    let base_session_id = if session_id.trim().is_empty() {
        match service.get_or_create_session(user_id, app_name).await {
            Ok(id) => id,
            Err(e) => {
                tracing::error!("Failed to create session: {}", e);
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
        }
    } else {
        session_id.clone()
    };

    let validated_session_id = match service
        .validate_or_create_session(&base_session_id, user_id, app_name)
        .await
    {
        Ok(id) => id,
        Err(e) => {
            tracing::error!("Session error: {}", e);
            on_event
                .send(AIResponseChunk {
                    content: None,
                    tool_call: None,
                    tool_operation: None,
                    error: Some(format!("Session error: {}", e)),
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
            tracing::error!("Failed to create runner: {}", e);
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

    // Run the agent and stream responses using the validated session_id
    let mut stream = match runner
        .run("default_user".to_string(), validated_session_id, user_content)
        .await
    {
        Ok(s) => s,
        Err(e) => {
            tracing::error!("Failed to run agent: {}", e);
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
                                    tracing::info!("stream text chunk size={}", text.len());
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
                                tracing::info!("tool call: {} args={}", name, args);
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
                                    "run_command" => (
                                        "Executing".to_string(),
                                        args.get("command")
                                            .and_then(|v| v.as_str())
                                            .unwrap_or("unknown")
                                            .to_string(),
                                    ),
                                    _ => (
                                        "Calling".to_string(),
                                        format!("{}()", name),
                                    ),
                                };

                                on_event
                                    .send(AIResponseChunk {
                                        content: None,
                                        tool_call: Some(format!("Calling tool: {}", name)),
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
                            _ => {}
                        }
                    }
                }
            }
            Err(e) => {
                tracing::error!("Stream error: {}", e);
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
    tracing::info!("Stream complete");
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
