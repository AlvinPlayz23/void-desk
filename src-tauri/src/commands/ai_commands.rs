//! AI Commands for Tauri
//!
//! This module provides Tauri commands for AI interactions using the custom SDK.

use super::ai_service::AIService;
use crate::sdk::{AIClient, AgentEvent, AgentRunHandle, ErrorCategory, Message, SdkError};
use anyhow::Error;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::ipc::Channel;
use tokio::sync::{OnceCell, RwLock};

const DEFAULT_CONTEXT_WINDOW_TOKENS: usize = 32_000;
const MIN_CONTEXT_WINDOW_TOKENS: usize = 1_024;

/// Global AI service instance (lazy initialized)
static AI_SERVICE: OnceCell<Arc<AIService>> = OnceCell::const_new();
static ACTIVE_RUNS: OnceCell<Arc<RwLock<HashMap<String, AgentRunHandle>>>> = OnceCell::const_new();

/// Get or initialize the global AI service
async fn get_ai_service() -> Arc<AIService> {
    AI_SERVICE
        .get_or_init(|| async { Arc::new(AIService::new()) })
        .await
        .clone()
}

async fn active_runs() -> Arc<RwLock<HashMap<String, AgentRunHandle>>> {
    ACTIVE_RUNS
        .get_or_init(|| async { Arc::new(RwLock::new(HashMap::new())) })
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ConversationHistoryMessage {
    pub role: String,
    pub content: String,
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
    history_messages: Option<Vec<ConversationHistoryMessage>>,
    api_key: String,
    base_url: String,
    model_id: String,
    context_window_tokens: Option<usize>,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
    request_id: Option<String>,
    on_event: Channel<AIResponseChunk>,
) -> Result<(), String> {
    let service = get_ai_service().await;
    let session_id = service
        .get_or_create_session("default_user")
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    process_ai_stream(StreamRequest {
        message,
        history_messages,
        api_key,
        base_url,
        model_id,
        context_window_tokens,
        active_path,
        debug_raw_stream,
        request_id,
        session_id,
        on_event,
    })
    .await
}

#[tauri::command]
pub async fn cancel_ai_stream(request_id: String) -> Result<bool, String> {
    if request_id.trim().is_empty() {
        return Ok(false);
    }

    let runs = active_runs().await;
    let handle = {
        let map = runs.read().await;
        map.get(&request_id).cloned()
    };

    if let Some(handle) = handle {
        handle.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
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
    let session = service.session_store().create(None, Some(name)).await;
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
    history_messages: Option<Vec<ConversationHistoryMessage>>,
    api_key: String,
    base_url: String,
    model_id: String,
    context_window_tokens: Option<usize>,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
    request_id: Option<String>,
    on_event: Channel<AIResponseChunk>,
) -> Result<(), String> {
    let service = get_ai_service().await;
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

    process_ai_stream(StreamRequest {
        message,
        history_messages,
        api_key,
        base_url,
        model_id,
        context_window_tokens,
        active_path,
        debug_raw_stream,
        request_id,
        session_id,
        on_event,
    })
    .await
}

struct StreamRequest {
    message: String,
    history_messages: Option<Vec<ConversationHistoryMessage>>,
    api_key: String,
    base_url: String,
    model_id: String,
    context_window_tokens: Option<usize>,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
    request_id: Option<String>,
    session_id: String,
    on_event: Channel<AIResponseChunk>,
}

async fn process_ai_stream(req: StreamRequest) -> Result<(), String> {
    let api_key = req.api_key.trim();
    let model_id = req.model_id.trim();

    if api_key.is_empty() {
        send_error_chunk(
            &req.on_event,
            "API key is required".to_string(),
            "validation",
        )?;
        return Ok(());
    }

    let service = get_ai_service().await;
    let model_context_window = AIClient::new(api_key, &req.base_url, model_id)
        .ok()
        .and_then(|client| client.model_info().context_window);
    let agent =
        AIService::create_agent(api_key, &req.base_url, model_id, req.active_path.as_deref())
            .map_err(|e| format!("Failed to create agent: {}", e))?;

    let session_store = service.session_store();
    let stored_history = session_store
        .get(&req.session_id)
        .await
        .map(|s| s.messages)
        .unwrap_or_default();
    let history = trim_history_to_context_window(
        resolve_request_history(stored_history, req.history_messages),
        resolve_effective_context_window(req.context_window_tokens, model_context_window),
    );

    let request_id = req
        .request_id
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    let debug_raw_stream = req.debug_raw_stream.unwrap_or(false);
    let (mut stream, run_handle) = agent
        .run_streaming_with_handle(req.message, history, debug_raw_stream)
        .await
        .map_err(|e| format!("Failed to run agent: {}", e))?;

    {
        let runs = active_runs().await;
        let mut map = runs.write().await;
        map.insert(request_id.clone(), run_handle);
    }

    let mut completed_normally = false;
    while let Some(event) = stream.next().await {
        match event {
            Ok(AgentEvent::TextDelta(text)) => {
                if !text.is_empty() {
                    req.on_event
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
            Ok(AgentEvent::ReasoningDelta(reasoning)) => {
                req.on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: Some(format!("reasoning: {}", reasoning)),
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::UsageDelta(usage)) => {
                req.on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: Some(format!(
                            "usage: prompt={:?} completion={:?} total={:?}",
                            usage.prompt_tokens, usage.completion_tokens, usage.total_tokens
                        )),
                        error: None,
                        error_type: None,
                        done: false,
                    })
                    .map_err(|e| e.to_string())?;
            }
            Ok(AgentEvent::ToolStart { name, input }) => {
                let (operation, target) = map_tool_operation(&name, &input);
                req.on_event
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
            Ok(AgentEvent::ToolResult {
                name,
                result,
                success,
            }) => {
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

                req.on_event
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
                req.on_event
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
            Ok(AgentEvent::Cancelled { reason, .. }) => {
                req.on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: None,
                        error: Some(reason),
                        error_type: Some("cancelled".to_string()),
                        done: true,
                    })
                    .map_err(|e| e.to_string())?;
                cleanup_run(&request_id).await;
                return Ok(());
            }
            Ok(AgentEvent::Done {
                final_text: _,
                messages,
            }) => {
                session_store
                    .replace_messages(&req.session_id, messages)
                    .await;
                completed_normally = true;
                break;
            }
            Err(err) => {
                let err_type = classify_error(&err);
                let error_message = format!("Stream error: {}", err);
                req.on_event
                    .send(AIResponseChunk {
                        content: None,
                        tool_call: None,
                        tool_operation: None,
                        debug: None,
                        error: Some(error_message),
                        error_type: Some(err_type.to_string()),
                        done: true,
                    })
                    .map_err(|e| e.to_string())?;
                cleanup_run(&request_id).await;
                return Ok(());
            }
        }
    }

    cleanup_run(&request_id).await;

    req.on_event
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

    if !completed_normally {
        return Ok(());
    }

    Ok(())
}

async fn cleanup_run(request_id: &str) {
    let runs = active_runs().await;
    let mut map = runs.write().await;
    map.remove(request_id);
}

fn send_error_chunk(
    on_event: &Channel<AIResponseChunk>,
    message: String,
    error_type: &str,
) -> Result<(), String> {
    on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            tool_operation: None,
            debug: None,
            error: Some(message),
            error_type: Some(error_type.to_string()),
            done: true,
        })
        .map_err(|e| e.to_string())
}

fn classify_error(err: &Error) -> &'static str {
    if let Some(sdk_err) = err.downcast_ref::<SdkError>() {
        return match sdk_err.category {
            ErrorCategory::Validation => "validation",
            ErrorCategory::Provider => "provider",
            ErrorCategory::Stream => "model",
            ErrorCategory::Tool => "tool",
            ErrorCategory::Permission => "permission",
            ErrorCategory::Timeout => "provider",
            ErrorCategory::Internal => "internal",
        };
    }

    let message = err.to_string().to_lowercase();
    if message.contains("permission") {
        return "permission";
    }
    if message.contains("timeout") || message.contains("api") || message.contains("network") {
        return "provider";
    }
    if message.contains("tool") {
        return "tool";
    }
    if message.contains("invalid") || message.contains("missing") || message.contains("required") {
        return "validation";
    }
    if message.contains("stream") || message.contains("parse") {
        return "model";
    }
    "internal"
}

fn map_tool_operation(name: &str, input: &serde_json::Value) -> (String, String) {
    match name {
        "read_file" => (
            "Reading".to_string(),
            input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "write_file" | "create_file" => (
            "Writing".to_string(),
            input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "edit_file" | "streaming_edit_file" => (
            "Editing".to_string(),
            input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "list_directory" => (
            "Listing".to_string(),
            input
                .get("path")
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string(),
        ),
        "run_command" => (
            "Running".to_string(),
            input
                .get("command")
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
        .and_then(|value| {
            value
                .get("path")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
        .unwrap_or_default()
}

fn extract_diff_from_result(result: &str) -> Option<String> {
    serde_json::from_str::<serde_json::Value>(result)
        .ok()
        .and_then(|value| {
            value
                .get("diff")
                .and_then(|v| v.as_str())
                .map(|s| s.to_string())
        })
}

fn resolve_request_history(
    stored_history: Vec<Message>,
    history_messages: Option<Vec<ConversationHistoryMessage>>,
) -> Vec<Message> {
    match history_messages {
        Some(messages) => convert_history_messages(messages),
        None => stored_history,
    }
}

fn convert_history_messages(history_messages: Vec<ConversationHistoryMessage>) -> Vec<Message> {
    history_messages
        .into_iter()
        .filter_map(|message| {
            let content = message.content.trim();
            if content.is_empty() {
                return None;
            }

            match message.role.as_str() {
                "user" => Some(Message::user(content.to_string())),
                "assistant" => Some(Message::assistant_text(content.to_string())),
                _ => None,
            }
        })
        .collect()
}

fn resolve_effective_context_window(
    requested_context_window: Option<usize>,
    model_context_window: Option<usize>,
) -> usize {
    let requested = requested_context_window.unwrap_or(DEFAULT_CONTEXT_WINDOW_TOKENS);
    let requested = requested.max(MIN_CONTEXT_WINDOW_TOKENS);

    match model_context_window {
        Some(model_limit) => requested.min(model_limit.max(MIN_CONTEXT_WINDOW_TOKENS)),
        None => requested,
    }
}

fn trim_history_to_context_window(
    history: Vec<Message>,
    context_window_tokens: usize,
) -> Vec<Message> {
    let reserve = (context_window_tokens / 5).clamp(512, 8_192);
    let history_budget = context_window_tokens.saturating_sub(reserve);
    if history_budget == 0 || history.is_empty() {
        return Vec::new();
    }

    let mut kept_reversed = Vec::new();
    let mut used_tokens = 0usize;

    for message in history.into_iter().rev() {
        let message_tokens = estimate_message_tokens(&message);
        if !kept_reversed.is_empty() && used_tokens + message_tokens > history_budget {
            break;
        }

        used_tokens += message_tokens;
        kept_reversed.push(message);
    }

    kept_reversed.reverse();
    kept_reversed
}

fn estimate_message_tokens(message: &Message) -> usize {
    let mut chars = message.text().chars().count();

    if let Some(tool_calls) = &message.tool_calls {
        for tool_call in tool_calls {
            chars += tool_call.function.name.chars().count();
            chars += tool_call.function.arguments.chars().count();
        }
    }

    if let Some(tool_call_id) = &message.tool_call_id {
        chars += tool_call_id.chars().count();
    }

    (chars / 4).max(1) + 8
}

#[cfg(test)]
mod tests {
    use super::{
        resolve_effective_context_window, resolve_request_history, trim_history_to_context_window,
        ConversationHistoryMessage,
    };
    use crate::sdk::Message;

    #[test]
    fn provided_history_rehydrates_session_requests() {
        let history = resolve_request_history(
            Vec::new(),
            Some(vec![
                ConversationHistoryMessage {
                    role: "user".to_string(),
                    content: "We were debugging a tool loop".to_string(),
                },
                ConversationHistoryMessage {
                    role: "assistant".to_string(),
                    content: "Yes, we traced it to retry handling.".to_string(),
                },
            ]),
        );

        assert_eq!(history.len(), 2);
        assert_eq!(history[0].role, "user");
        assert_eq!(history[1].role, "assistant");
    }

    #[test]
    fn empty_provided_history_clears_prior_context() {
        let history =
            resolve_request_history(vec![Message::user("old context".to_string())], Some(vec![]));
        assert!(history.is_empty());
    }

    #[test]
    fn trim_history_keeps_newest_messages_within_budget() {
        let history = vec![
            Message::user("first turn with some content".to_string()),
            Message::assistant_text("first reply with some content".to_string()),
            Message::user("second turn with some content".to_string()),
            Message::assistant_text("second reply with some content".to_string()),
        ];

        let trimmed = trim_history_to_context_window(history, 80);

        assert!(trimmed.len() < 4);
        assert_eq!(
            trimmed.last().map(|m| m.text()),
            Some("second reply with some content".to_string())
        );
    }

    #[test]
    fn context_window_respects_known_model_limit() {
        assert_eq!(
            resolve_effective_context_window(Some(64_000), Some(32_000)),
            32_000
        );
        assert_eq!(
            resolve_effective_context_window(Some(8_000), Some(32_000)),
            8_000
        );
    }
}
