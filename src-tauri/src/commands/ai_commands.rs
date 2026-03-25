//! AI Commands for Tauri
//!
//! This module provides Tauri commands for AI interactions using the custom SDK.

use super::ai_service::AIService;
use super::codex_auth::CodexAuthState;
use crate::sdk::{
    AgentEvent, AgentRunHandle, ErrorCategory, InlineImageAttachment, Message, SdkError,
};
use anyhow::Error;
use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tauri::{ipc::Channel, State};
use tokio::sync::{OnceCell, RwLock};

const DEFAULT_CONTEXT_WINDOW_TOKENS: usize = 32_000;
const MIN_CONTEXT_WINDOW_TOKENS: usize = 1_024;

static ACTIVE_RUNS: OnceCell<Arc<RwLock<ActiveRunRegistry>>> = OnceCell::const_new();

#[derive(Clone)]
struct ActiveRunEntry {
    session_id: String,
    handle: AgentRunHandle,
}

#[derive(Default)]
struct ActiveRunRegistry {
    request_runs: HashMap<String, ActiveRunEntry>,
    session_runs: HashMap<String, String>,
}

async fn active_runs() -> Arc<RwLock<ActiveRunRegistry>> {
    ACTIVE_RUNS
        .get_or_init(|| async { Arc::new(RwLock::new(ActiveRunRegistry::default())) })
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
    pub reasoning: Option<String>,
    pub debug: Option<String>,
    pub debug_type: Option<String>,
    pub error: Option<String>,
    pub error_type: Option<String>,
    pub error_status: Option<u16>,
    pub retryable: Option<bool>,
    pub done: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub struct ConversationHistoryMessage {
    pub role: String,
    pub content: String,
}

#[tauri::command]
pub async fn test_ai_connection(
    provider_type: Option<String>,
    api_key: String,
    base_url: String,
    model_id: String,
    codex_auth: State<'_, CodexAuthState>,
) -> Result<String, String> {
    let provider_type = provider_type
        .as_deref()
        .unwrap_or("openai_compatible")
        .trim();
    let api_key = api_key.trim();
    let model_id = model_id.trim();

    if provider_type != "codex_subscription" && api_key.is_empty() {
        return Err("API key is required".to_string());
    }

    if model_id.is_empty() {
        return Err("Model ID is required".to_string());
    }

    let agent = AIService::create_agent(
        provider_type,
        api_key,
        &base_url,
        model_id,
        None,
        Some(codex_auth.auth_path()),
    )
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
    provider_type: Option<String>,
    api_key: String,
    base_url: String,
    model_id: String,
    context_window_tokens: Option<usize>,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
    request_id: Option<String>,
    on_event: Channel<AIResponseChunk>,
    service: State<'_, AIService>,
    codex_auth: State<'_, CodexAuthState>,
) -> Result<(), String> {
    let session_id = service
        .get_or_create_session("default_user")
        .await
        .map_err(|e| format!("Failed to create session: {}", e))?;

    let req = StreamRequest {
        message,
        history_messages,
        provider_type: provider_type.unwrap_or_else(|| "openai_compatible".to_string()),
        api_key,
        base_url,
        model_id,
        context_window_tokens,
        active_path,
        debug_raw_stream,
        request_id,
        image_attachments: None,
        session_id,
        on_event,
        codex_auth_path: codex_auth.auth_path(),
    };
    process_ai_stream(req, service.inner()).await
}

fn total_inline_image_bytes(attachments: &[InlineImageAttachment]) -> usize {
    attachments
        .iter()
        .map(|attachment| {
            attachment
                .optimized_bytes
                .or(attachment.source_bytes)
                .unwrap_or(attachment.data_url.len())
        })
        .sum()
}

#[tauri::command]
pub async fn cancel_ai_stream(request_id: String) -> Result<bool, String> {
    if request_id.trim().is_empty() {
        return Ok(false);
    }

    let runs = active_runs().await;
    let handle = {
        let map = runs.read().await;
        map.request_runs
            .get(&request_id)
            .map(|entry| entry.handle.clone())
    };

    if let Some(handle) = handle {
        handle.cancel();
        Ok(true)
    } else {
        Ok(false)
    }
}

#[tauri::command]
pub async fn reset_ai_conversation(service: State<'_, AIService>) -> Result<(), String> {
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
    provider_type: Option<String>,
    api_key: String,
    base_url: String,
    model_id: String,
    on_event: Channel<InlineCompletionChunk>,
    codex_auth: State<'_, CodexAuthState>,
) -> Result<(), String> {
    let provider_type = provider_type
        .as_deref()
        .unwrap_or("openai_compatible")
        .trim();
    let api_key = api_key.trim();
    let model_id = model_id.trim();

    if provider_type != "codex_subscription" && api_key.is_empty() {
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

    let agent = AIService::create_agent(
        provider_type,
        api_key,
        &base_url,
        model_id,
        None,
        Some(codex_auth.auth_path()),
    )
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
            Ok(AgentEvent::Done(_)) => break,
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
pub async fn create_chat_session(
    name: String,
    service: State<'_, AIService>,
) -> Result<String, String> {
    let session = service.session_store().create(None, Some(name)).await;
    Ok(session.id)
}

#[tauri::command]
pub async fn list_chat_sessions(
    service: State<'_, AIService>,
) -> Result<Vec<SessionMetadata>, String> {
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
pub async fn delete_chat_session(
    session_id: String,
    service: State<'_, AIService>,
) -> Result<(), String> {
    service.delete_session(&session_id).await;
    Ok(())
}

#[tauri::command]
pub async fn rename_chat_session(
    session_id: String,
    name: String,
    service: State<'_, AIService>,
) -> Result<(), String> {
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
    provider_type: Option<String>,
    api_key: String,
    base_url: String,
    model_id: String,
    context_window_tokens: Option<usize>,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
    request_id: Option<String>,
    image_attachments: Option<Vec<InlineImageAttachment>>,
    on_event: Channel<AIResponseChunk>,
    service: State<'_, AIService>,
    codex_auth: State<'_, CodexAuthState>,
) -> Result<(), String> {
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

    let req = StreamRequest {
        message,
        history_messages,
        provider_type: provider_type.unwrap_or_else(|| "openai_compatible".to_string()),
        api_key,
        base_url,
        model_id,
        context_window_tokens,
        active_path,
        debug_raw_stream,
        request_id,
        image_attachments,
        session_id,
        on_event,
        codex_auth_path: codex_auth.auth_path(),
    };
    process_ai_stream(req, service.inner()).await
}

struct StreamRequest {
    message: String,
    history_messages: Option<Vec<ConversationHistoryMessage>>,
    provider_type: String,
    api_key: String,
    base_url: String,
    model_id: String,
    context_window_tokens: Option<usize>,
    active_path: Option<String>,
    debug_raw_stream: Option<bool>,
    request_id: Option<String>,
    image_attachments: Option<Vec<InlineImageAttachment>>,
    session_id: String,
    on_event: Channel<AIResponseChunk>,
    codex_auth_path: std::path::PathBuf,
}

async fn process_ai_stream(req: StreamRequest, service: &AIService) -> Result<(), String> {
    let provider_type = req.provider_type.trim();
    let api_key = req.api_key.trim();
    let model_id = req.model_id.trim();
    let request_id = req
        .request_id
        .clone()
        .filter(|v| !v.trim().is_empty())
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());

    if provider_type != "codex_subscription" && api_key.is_empty() {
        send_error_chunk(
            &req.on_event,
            "API key is required".to_string(),
            "validation",
            None,
            Some(false),
        )?;
        return Ok(());
    }

    let image_attachments_count = req
        .image_attachments
        .as_ref()
        .map(|imgs| imgs.len())
        .unwrap_or(0);
    let image_attachments_bytes = req
        .image_attachments
        .as_ref()
        .map(|imgs| total_inline_image_bytes(imgs))
        .unwrap_or(0);

    // Debug: log details of each image attachment
    if let Some(ref attachments) = req.image_attachments {
        for (i, att) in attachments.iter().enumerate() {
            let detail_str = att.detail.as_deref().unwrap_or("none");
            send_debug_chunk(
                &req.on_event,
                format!(
                    "Image attachment {}: name={}, mimeType={}, dataUrl_len={}, detail={}, sourceBytes={:?}, optimizedBytes={:?}",
                    i,
                    att.name,
                    att.mime_type,
                    att.data_url.len(),
                    detail_str,
                    att.source_bytes,
                    att.optimized_bytes
                ),
                "backend",
            )?;
        }
    }

    send_debug_chunk(
        &req.on_event,
        format!(
            "Request {} received: model={}, message_chars={}, override_history={}, image_attachments={}, image_bytes={}, raw_stream={}",
            request_id,
            model_id,
            req.message.len(),
            req.history_messages.as_ref().map(|msgs| msgs.len()).unwrap_or(0),
            image_attachments_count,
            image_attachments_bytes,
            req.debug_raw_stream.unwrap_or(false)
        ),
        "backend",
    )?;

    let build = match AIService::create_agent_build(
        provider_type,
        api_key,
        &req.base_url,
        model_id,
        req.active_path.as_deref(),
        Some(req.codex_auth_path.clone()),
    ) {
        Ok(build) => build,
        Err(err) => {
            send_error_chunk(
                &req.on_event,
                format!("Failed to create agent: {}", err),
                "internal",
                None,
                Some(false),
            )?;
            return Ok(());
        }
    };
    let model_context_window = build.model_info.context_window;
    let effective_context_window =
        resolve_effective_context_window(req.context_window_tokens, model_context_window);
    let agent = build.agent;

    send_debug_chunk(
        &req.on_event,
        format!(
            "Agent created for request {}. active_path={:?}, model_context_window={:?}, effective_context_window={}",
            request_id,
            req.active_path,
            model_context_window,
            effective_context_window
        ),
        "backend",
    )?;

    let session_store = service.session_store();
    let stored_history = session_store
        .get(&req.session_id)
        .await
        .map(|s| s.messages)
        .unwrap_or_default();
    let stored_history_count = stored_history.len();
    let has_stored_history = !stored_history.is_empty();
    let hydrated_history = if has_stored_history {
        stored_history
    } else {
        resolve_request_history(Vec::new(), req.history_messages.clone())
    };
    if !has_stored_history && !hydrated_history.is_empty() {
        session_store
            .replace_messages(&req.session_id, hydrated_history.clone())
            .await;
    }
    let history = trim_history_to_context_window(hydrated_history, effective_context_window);

    send_debug_chunk(
        &req.on_event,
        format!(
            "History prepared for request {}: stored={}, trimmed_for_run={}, session_id={}, source={}",
            request_id,
            stored_history_count,
            history.len(),
            req.session_id,
            if has_stored_history { "stored" } else { "provided" }
        ),
        "backend",
    )?;

    if let Some(existing_request_id) = active_request_for_session(&req.session_id).await {
        send_error_chunk(
            &req.on_event,
            format!(
                "Session {} already has an active run ({})",
                req.session_id, existing_request_id
            ),
            "busy",
            None,
            Some(false),
        )?;
        return Ok(());
    }

    let debug_raw_stream = req.debug_raw_stream.unwrap_or(false);
    let image_attachments = req.image_attachments.unwrap_or_default();
    let (mut stream, run_handle) = match agent
        .run_streaming_with_handle(req.message, history, debug_raw_stream, image_attachments)
        .await
    {
        Ok(result) => result,
        Err(err) => {
            let err_type = classify_error(&err);
            send_error_chunk(
                &req.on_event,
                format!("Failed to run agent: {}", err),
                err_type,
                sdk_error_status(&err),
                sdk_error_retryable(&err),
            )?;
            return Ok(());
        }
    };

    if let Some(existing_request_id) =
        register_active_run(&request_id, &req.session_id, run_handle).await?
    {
        send_error_chunk(
            &req.on_event,
            format!(
                "Session {} already has an active run ({})",
                req.session_id, existing_request_id
            ),
            "busy",
            None,
            Some(false),
        )?;
        return Ok(());
    }

    send_debug_chunk(
        &req.on_event,
        format!("Request {} registered as active run", request_id),
        "backend",
    )?;

    let stream_result: Result<bool, String> = async {
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
                                reasoning: None,
                                debug: None,
                                debug_type: None,
                                error: None,
                                error_type: None,
                                error_status: None,
                                retryable: None,
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
                            reasoning: Some(reasoning.clone()),
                            debug: Some(format!("reasoning: {}", reasoning)),
                            debug_type: Some("stream".to_string()),
                            error: None,
                            error_type: None,
                            error_status: None,
                            retryable: None,
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
                            reasoning: None,
                            debug: Some(format!(
                                "usage: prompt={:?} completion={:?} total={:?}",
                                usage.prompt_tokens, usage.completion_tokens, usage.total_tokens
                            )),
                            debug_type: Some("stream".to_string()),
                            error: None,
                            error_type: None,
                            error_status: None,
                            retryable: None,
                            done: false,
                        })
                        .map_err(|e| e.to_string())?;
                }
                Ok(AgentEvent::ToolStart(event)) => {
                    let (operation, target) = map_tool_operation(&event.name, &event.input);
                    req.on_event
                        .send(AIResponseChunk {
                            content: None,
                            tool_call: Some(format!("Calling tool: {}", event.name)),
                            tool_operation: Some(ToolOperation {
                                operation,
                                target,
                                status: "started".to_string(),
                                details: None,
                            }),
                            reasoning: None,
                            debug: None,
                            debug_type: None,
                            error: None,
                            error_type: None,
                            error_status: None,
                            retryable: None,
                            done: false,
                        })
                        .map_err(|e| e.to_string())?;
                }
                Ok(AgentEvent::ToolResult(event)) => {
                    let status = if event.success { "completed" } else { "failed" };
                    let operation = match event.name.as_str() {
                        "read_file" => "Read",
                        "write_file" => "Created",
                        "edit_file" => "Edited",
                        "streaming_edit_file" => "Edited",
                        "list_directory" => "Listed",
                        "run_command" => "Executed",
                        _ => "Completed",
                    };

                    let target = extract_target_from_result(&event.result);
                    let details = extract_diff_from_result(&event.result);

                    req.on_event
                        .send(AIResponseChunk {
                            content: None,
                            tool_call: Some(format!("Tool {} returned", event.name)),
                            tool_operation: Some(ToolOperation {
                                operation: operation.to_string(),
                                target,
                                status: status.to_string(),
                                details,
                            }),
                            reasoning: None,
                            debug: None,
                            debug_type: None,
                            error: None,
                            error_type: None,
                            error_status: None,
                            retryable: None,
                            done: false,
                        })
                        .map_err(|e| e.to_string())?;
                }
                Ok(AgentEvent::Debug(event)) => {
                    req.on_event
                        .send(AIResponseChunk {
                            content: None,
                            tool_call: None,
                            tool_operation: None,
                            reasoning: None,
                            debug: Some(event.message),
                            debug_type: Some(event.kind),
                            error: None,
                            error_type: None,
                            error_status: None,
                            retryable: None,
                            done: false,
                        })
                        .map_err(|e| e.to_string())?;
                }
                Ok(AgentEvent::Cancelled(event)) => {
                    let retained_messages =
                        prune_session_history(event.messages, effective_context_window);
                    session_store
                        .replace_messages(&req.session_id, retained_messages)
                        .await;
                    req.on_event
                        .send(AIResponseChunk {
                            content: None,
                            tool_call: None,
                            tool_operation: None,
                            reasoning: None,
                            debug: None,
                            debug_type: None,
                            error: Some(event.reason),
                            error_type: Some("cancelled".to_string()),
                            error_status: None,
                            retryable: Some(false),
                            done: true,
                        })
                        .map_err(|e| e.to_string())?;
                    return Ok(false);
                }
                Ok(AgentEvent::Done(event)) => {
                    let retained_messages =
                        prune_session_history(event.messages, effective_context_window);
                    let retained_count = retained_messages.len();
                    session_store
                        .replace_messages(&req.session_id, retained_messages)
                        .await;
                    send_debug_chunk(
                        &req.on_event,
                        format!(
                            "Request {} completed and session {} was updated with {} retained messages",
                            request_id, req.session_id, retained_count
                        ),
                        "success",
                    )?;
                    completed_normally = true;
                    break;
                }
                Err(err) => {
                    let err_type = classify_error(&err);
                    let error_message = format!("Stream error: {}", err);
                    send_debug_chunk(
                        &req.on_event,
                        format!("Request {} terminated with {} error", request_id, err_type),
                        "error",
                    )?;
                    req.on_event
                        .send(AIResponseChunk {
                            content: None,
                            tool_call: None,
                            tool_operation: None,
                            reasoning: None,
                            debug: None,
                            debug_type: None,
                            error: Some(error_message),
                            error_type: Some(err_type.to_string()),
                            error_status: sdk_error_status(&err),
                            retryable: sdk_error_retryable(&err),
                            done: true,
                        })
                        .map_err(|e| e.to_string())?;
                    return Ok(false);
                }
            }
        }

        Ok(completed_normally)
    }
    .await;

    cleanup_run(&request_id).await;

    let completed_normally = stream_result?;

    send_debug_chunk(
        &req.on_event,
        format!(
            "Request {} cleaned up; completed_normally={}",
            request_id, completed_normally
        ),
        if completed_normally {
            "success"
        } else {
            "backend"
        },
    )?;

    req.on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            tool_operation: None,
            reasoning: None,
            debug: None,
            debug_type: None,
            error: None,
            error_type: None,
            error_status: None,
            retryable: None,
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
    let mut registry = runs.write().await;
    if let Some(entry) = registry.request_runs.remove(request_id) {
        let should_remove_session = registry
            .session_runs
            .get(&entry.session_id)
            .map(|active_request_id| active_request_id == request_id)
            .unwrap_or(false);
        if should_remove_session {
            registry.session_runs.remove(&entry.session_id);
        }
    }
}

async fn register_active_run(
    request_id: &str,
    session_id: &str,
    handle: AgentRunHandle,
) -> Result<Option<String>, String> {
    let runs = active_runs().await;
    let mut registry = runs.write().await;
    if let Some(existing_request_id) = registry.session_runs.get(session_id).cloned() {
        return Ok(Some(existing_request_id));
    }

    registry.request_runs.insert(
        request_id.to_string(),
        ActiveRunEntry {
            session_id: session_id.to_string(),
            handle,
        },
    );
    registry
        .session_runs
        .insert(session_id.to_string(), request_id.to_string());
    Ok(None)
}

async fn active_request_for_session(session_id: &str) -> Option<String> {
    let runs = active_runs().await;
    let registry = runs.read().await;
    registry.session_runs.get(session_id).cloned()
}

fn send_error_chunk(
    on_event: &Channel<AIResponseChunk>,
    message: String,
    error_type: &str,
    error_status: Option<u16>,
    retryable: Option<bool>,
) -> Result<(), String> {
    on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            tool_operation: None,
            reasoning: None,
            debug: None,
            debug_type: None,
            error: Some(message),
            error_type: Some(error_type.to_string()),
            error_status,
            retryable,
            done: true,
        })
        .map_err(|e| e.to_string())
}

fn send_debug_chunk(
    on_event: &Channel<AIResponseChunk>,
    message: String,
    debug_type: &str,
) -> Result<(), String> {
    on_event
        .send(AIResponseChunk {
            content: None,
            tool_call: None,
            tool_operation: None,
            reasoning: None,
            debug: Some(message),
            debug_type: Some(debug_type.to_string()),
            error: None,
            error_type: None,
            error_status: None,
            retryable: None,
            done: false,
        })
        .map_err(|e| e.to_string())
}

fn sdk_error_status(err: &Error) -> Option<u16> {
    err.downcast_ref::<SdkError>()
        .and_then(|sdk_err| sdk_err.status)
}

fn sdk_error_retryable(err: &Error) -> Option<bool> {
    err.downcast_ref::<SdkError>()
        .map(|sdk_err| sdk_err.retryable)
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

fn prune_session_history(messages: Vec<Message>, effective_context_window: usize) -> Vec<Message> {
    trim_history_to_context_window(messages, effective_context_window)
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
