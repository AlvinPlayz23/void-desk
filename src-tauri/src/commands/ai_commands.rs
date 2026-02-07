//! AI Commands for Tauri
//!
//! This module provides Tauri commands for AI interactions using the custom SDK.

use super::ai_service::AIService;
use crate::sdk::AgentEvent;
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
pub struct ToolOperation {
    pub operation: String,
    pub target: String,
    pub status: String,
    pub details: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AIResponseChunk {
    pub content: Option<String>,
    pub tool_call: Option<String>,
    pub tool_operation: Option<ToolOperation>,
    pub debug: Option<String>,
    pub error: Option<String>,
    pub error_type: Option<String>,
    pub done: bool,
}

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

    let agent = AIService::create_agent(api_key, &base_url, model_id, None)
        .map_err(|e| format!("Failed to create agent: {}", e))?;

    let result = agent
        .run("Say 'Connection Successful'".to_string(), Vec::new())
        .await
        .map_err(|e| format!("Connection test failed: {}", e))?;

    if result.text.is_empty() {
        Err("No response from API".to_string())
    } else {
        Ok("Connection successful! API is responsive.".to_string())
    }
}

#[tauri::command]
pub async fn ask_ai_stream(
    message: String,
    api_key: String,
    base_url: String,
    model_id: String,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
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
                debug: None,
                error: Some("API key is required".to_string()),
                error_type: Some("validation".to_string()),
                done: true,
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let service = get_ai_service().await;
    let agent = AIService::create_agent(api_key, &base_url, model_id, active_path.as_deref())
        .map_err(|e| format!("Failed to create agent: {}", e))?;

    let session_id = service
        .get_or_create_session("default_user")
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;
    let session_store = service.session_store();
    let history = session_store
        .get(&session_id)
        .await
        .map(|s| s.messages)
        .unwrap_or_default();

    let debug_raw_stream = debug_raw_stream.unwrap_or(false);
    let mut stream = agent
        .run_streaming_with_debug(message, history, debug_raw_stream)
        .await
        .map_err(|e| format!("Failed to run agent: {}", e))?;

    while let Some(event) = stream.next().await {
        match event {
            Ok(AgentEvent::TextDelta(text)) => {
                if !text.is_empty() {
                    on_event
                        .send(AIResponseChunk {
                            content: Some(text),
                            tool_call: None,
                            tool_operation: None,
                            debug: None,
                            error: None,
                            error_type: None,
                            done: false,
                        })
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(AgentEvent::ToolStart { name, input }) => {
                let (operation, target) = map_tool_operation(&name, &input);
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: Some(format!("Calling tool: {}", name)),
                        tool_operation: Some(ToolOperation {
                            operation,
                            target,
                            status: "started".to_string(),
                            details: None,
                        }),
                        debug: None,
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::ToolResult { name, result, success }) => {
                let status = if success { "completed" } else { "failed" };
                let operation = match name.as_str() {
                    "read_file" => "Read",
                    "write_file" => "Created",
                    "edit_file" => "Edited",
                    "streaming_edit_file" => "Edited",
                    "list_directory" => "Listed",
                    "run_command" => "Executed",
                    _ => "Completed",
                };

                let target = extract_target_from_result(&result);
                let details = extract_diff_from_result(&result);

                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: Some(format!("Tool {} returned", name)),
                        tool_operation: Some(ToolOperation {
                            operation: operation.to_string(),
                            target,
                            status: status.to_string(),
                            details,
                        }),
                        debug: None,
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::Debug(raw)) => {
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: Some(raw),
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::Done { final_text: _, messages }) => {
                session_store.replace_messages(&session_id, messages).await;
                // Break out of the loop - agent is done
                break;
            }
            Err(err) => {
                let error_message = format!("Stream error: {}", err);
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: None,
                        error: Some(error_message.clone()),
                        error_type: Some(classify_error(&error_message).to_string()),
                        done: true,
                    })
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            tool_operation: None,
            debug: None,
            error: None,
            error_type: None,
            done: true,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

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

    let agent = AIService::create_agent(api_key, &base_url, model_id, None)
        .map_err(|e| format!("Failed to create agent: {}", e))?
        .with_max_iterations(1);

    let mut stream = agent
        .run_streaming(prompt, Vec::new())
        .await
        .map_err(|e| format!("Failed to run agent: {}", e))?;

    while let Some(event) = stream.next().await {
        match event {
            Ok(AgentEvent::TextDelta(text)) => {
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
            Ok(AgentEvent::Done { .. }) => break,
            Ok(_) => {}
            Err(err) => {
                on_event
                    .send(InlineCompletionChunk {
                        text: String::new(),
                        done: true,
                        error: Some(format!("Stream error: {}", err)),
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

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct SessionMetadata {
    pub id: String,
    pub created_at: i64,
    pub last_updated: i64,
    pub name: String,
    pub message_count: usize,
}

#[tauri::command]
pub async fn create_chat_session(name: String) -> Result<String, String> {
    let service = get_ai_service().await;
    let session = service
        .session_store()
        .create(None, Some(name))
        .await;
    Ok(session.id)
}

#[tauri::command]
pub async fn list_chat_sessions() -> Result<Vec<SessionMetadata>, String> {
    let service = get_ai_service().await;
    let sessions = service.session_store().list().await;
    let metadata = sessions
        .into_iter()
        .map(|session| SessionMetadata {
            id: session.id,
            created_at: session.created_at.timestamp_millis(),
            last_updated: session.updated_at.timestamp_millis(),
            name: session.name.unwrap_or_else(|| "Untitled".to_string()),
            message_count: session.messages.len(),
        })
        .collect();
    Ok(metadata)
}

#[tauri::command]
pub async fn delete_chat_session(session_id: String) -> Result<(), String> {
    let service = get_ai_service().await;
    service.session_store().delete(&session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn rename_chat_session(session_id: String, name: String) -> Result<(), String> {
    let service = get_ai_service().await;
    service
        .session_store()
        .set_name(&session_id, Some(name))
        .await;
    Ok(())
}

#[tauri::command]
pub async fn ask_ai_stream_with_session(
    session_id: String,
    message: String,
    api_key: String,
    base_url: String,
    model_id: String,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
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
                debug: None,
                error: Some("API key is required".to_string()),
                error_type: Some("validation".to_string()),
                done: true,
            })
            .map_err(|e| e.to_string())?;
        return Ok(());
    }

    let service = get_ai_service().await;
    let agent = AIService::create_agent(api_key, &base_url, model_id, active_path.as_deref())
        .map_err(|e| format!("Failed to create agent: {}", e))?;

    let session_id = if session_id.trim().is_empty() {
        service
            .get_or_create_session("default_user")
            .await
            .map_err(|e| format!("Failed to create session: {}", e))?
    } else {
        service
            .validate_or_create_session(&session_id)
            .await
            .map_err(|e| format!("Session error: {}", e))?
    };

    let session_store = service.session_store();
    let history = session_store
        .get(&session_id)
        .await
        .map(|s| s.messages)
        .unwrap_or_default();

    let debug_raw_stream = debug_raw_stream.unwrap_or(false);
    let mut stream = agent
        .run_streaming_with_debug(message, history, debug_raw_stream)
        .await
        .map_err(|e| format!("Failed to run agent: {}", e))?;

    while let Some(event) = stream.next().await {
        match event {
            Ok(AgentEvent::TextDelta(text)) => {
                if !text.is_empty() {
                    on_event
                        .send(AIResponseChunk {
                            content: Some(text),
                            tool_call: None,
                            tool_operation: None,
                            debug: None,
                            error: None,
                            error_type: None,
                            done: false,
                        })
                        .map_err(|e| e.to_string())?;
                }
            }
            Ok(AgentEvent::ToolStart { name, input }) => {
                let (operation, target) = map_tool_operation(&name, &input);
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: Some(format!("Calling tool: {}", name)),
                        tool_operation: Some(ToolOperation {
                            operation,
                            target,
                            status: "started".to_string(),
                            details: None,
                        }),
                        debug: None,
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::ToolResult { name, result, success }) => {
                let status = if success { "completed" } else { "failed" };
                let operation = match name.as_str() {
                    "read_file" => "Read",
                    "write_file" => "Created",
                    "edit_file" => "Edited",
                    "streaming_edit_file" => "Edited",
                    "list_directory" => "Listed",
                    "run_command" => "Executed",
                    _ => "Completed",
                };

                let target = extract_target_from_result(&result);
                let details = extract_diff_from_result(&result);

                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: Some(format!("Tool {} returned", name)),
                        tool_operation: Some(ToolOperation {
                            operation: operation.to_string(),
                            target,
                            status: status.to_string(),
                            details,
                        }),
                        debug: None,
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::Debug(raw)) => {
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: Some(raw),
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::Done { final_text: _, messages }) => {
                session_store.replace_messages(&session_id, messages).await;
                break;
            }
            Err(err) => {
                let error_message = format!("Stream error: {}", err);
                on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: None,
                        error: Some(error_message.clone()),
                        error_type: Some(classify_error(&error_message).to_string()),
                        done: true,
                    })
                    .map_err(|e| e.to_string())?;
                return Ok(());
            }
        }
    }

    on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            tool_operation: None,
            debug: None,
            error: None,
            error_type: None,
            done: true,
        })
        .map_err(|e| e.to_string())?;

    Ok(())
}

fn map_tool_operation(name: &str, input: &serde_json::Value) -> (String, String) {
    match name {
        "read_file" => (
            "Reading".to_string(),
            input.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "write_file" | "create_file" => (
            "Writing".to_string(),
            input.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "edit_file" => (
            "Editing".to_string(),
            input.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "streaming_edit_file" => (
            "Editing".to_string(),
            input.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "list_directory" => (
            "Listing".to_string(),
            input.get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "run_command" => (
            "Running".to_string(),
            input.get("command")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        _ => ("Calling".to_string(), name.to_string()),
    }
}

fn extract_target_from_result(result: &str) -> String {
    serde_json::from_str::<serde_json::Value>(result)
        .ok()
        .and_then(|value| value.get("path").and_then(|v| v.as_str()).map(|s| s.to_string()))
        .unwrap_or_default()
}

fn extract_diff_from_result(result: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(result)
        .ok()
        .and_then(|value| value.get("diff").and_then(|v| v.as_str()).map(|s| s.to_string()))
}

fn classify_error(message: &str) -> &'static str {
    let lowered = message.to_lowercase();
    if lowered.contains("permission")
        || lowered.contains("access denied")
        || lowered.contains("sensitive path")
    {
        return "permission";
    }
    if lowered.contains("api error")
        || lowered.contains("invalid status code")
        || lowered.contains("connection")
        || lowered.contains("timeout")
    {
        return "provider";
    }
    if lowered.contains("tool")
        || lowered.contains("old_text")
        || lowered.contains("edits")
        || lowered.contains("line")
    {
        return "tool";
    }
    if lowered.contains("required")
        || lowered.contains("invalid")
        || lowered.contains("missing")
    {
        return "validation";
    }
    if lowered.contains("stream error") || lowered.contains("parse") {
        return "model";
    }
    "internal"
}
