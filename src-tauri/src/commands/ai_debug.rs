//! AI Debug Commands - For testing and debugging AI API calls

use futures::StreamExt;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use crate::commands::ai_service::AIService;
use crate::sdk::AgentEvent;

#[derive(Debug, Serialize)]
struct DebugRequest {
    model: String,
    messages: Vec<Value>,
    tools: Vec<Value>,
    stream: bool,
    max_tokens: u32,
}

#[derive(Debug, Deserialize)]
struct DebugResponse {
    choices: Option<Vec<Value>>,
    error: Option<Value>,
}

/// Debug command to test tool calling with raw request/response logging
#[tauri::command]
pub async fn debug_tool_call(
    api_key: String,
    base_url: String,
    model_id: String,
) -> Result<String, String> {
    let mut logs = Vec::new();
    
    // Normalize base URL
    let base_url = base_url.trim().trim_end_matches('/');
    let base_url = if base_url.ends_with("/v1") {
        base_url.to_string()
    } else {
        format!("{}/v1", base_url)
    };
    
    logs.push(format!("=== DEBUG TOOL CALL TEST ==="));
    logs.push(format!("Base URL: {}", base_url));
    logs.push(format!("Model: {}", model_id));
    
    // Build request with a simple tool
    let request = json!({
        "model": model_id,
        "messages": [
            {
                "role": "system",
                "content": "You are a helpful assistant. When asked to read a file, use the read_file tool."
            },
            {
                "role": "user",
                "content": "Please read the file called test.txt"
            }
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read a file from the project",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": {
                                "type": "string",
                                "description": "Path to the file"
                            }
                        },
                        "required": ["path"]
                    }
                }
            }
        ],
        "stream": false,
        "max_tokens": 1024
    });
    
    logs.push(format!("\n=== REQUEST ==="));
    logs.push(serde_json::to_string_pretty(&request).unwrap_or_default());
    
    // Make the request
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
            .map_err(|e| format!("Invalid API key: {}", e))?,
    );
    
    let url = format!("{}/chat/completions", base_url);
    logs.push(format!("\n=== SENDING TO: {} ===", url));
    
    let response = client
        .post(&url)
        .headers(headers)
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    let status = response.status();
    logs.push(format!("\n=== RESPONSE STATUS: {} ===", status));
    
    let response_text = response
        .text()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;
    
    logs.push(format!("\n=== RAW RESPONSE ==="));
    logs.push(response_text.clone());
    
    // Try to parse and analyze
    if let Ok(parsed) = serde_json::from_str::<Value>(&response_text) {
        logs.push(format!("\n=== PARSED RESPONSE ==="));
        logs.push(serde_json::to_string_pretty(&parsed).unwrap_or_default());
        
        // Check for tool calls
        if let Some(choices) = parsed.get("choices").and_then(|c| c.as_array()) {
            if let Some(first_choice) = choices.get(0) {
                if let Some(message) = first_choice.get("message") {
                    logs.push(format!("\n=== MESSAGE ANALYSIS ==="));
                    logs.push(format!("Role: {:?}", message.get("role")));
                    logs.push(format!("Content: {:?}", message.get("content")));
                    logs.push(format!("Tool Calls: {:?}", message.get("tool_calls")));
                    
                    if message.get("tool_calls").is_some() {
                        logs.push(format!("\n✅ TOOL CALLS DETECTED!"));
                    } else {
                        logs.push(format!("\n❌ NO TOOL CALLS IN RESPONSE"));
                        logs.push(format!("The model responded with text instead of using tools."));
                    }
                }
                
                logs.push(format!("Finish Reason: {:?}", first_choice.get("finish_reason")));
            }
        }
        
        // Check for errors
        if let Some(error) = parsed.get("error") {
            logs.push(format!("\n❌ API ERROR: {:?}", error));
        }
    }
    
    Ok(logs.join("\n"))
}

/// Debug streaming response
#[tauri::command]
pub async fn debug_stream_response(
    api_key: String,
    base_url: String,
    model_id: String,
) -> Result<String, String> {
    use futures::StreamExt;
    
    let mut logs = Vec::new();
    
    let base_url = base_url.trim().trim_end_matches('/');
    let base_url = if base_url.ends_with("/v1") {
        base_url.to_string()
    } else {
        format!("{}/v1", base_url)
    };
    
    logs.push(format!("=== DEBUG STREAMING TEST ==="));
    
    let request = json!({
        "model": model_id,
        "messages": [
            {
                "role": "system", 
                "content": "You are a helpful assistant. Always use the read_file tool when asked to read files."
            },
            {
                "role": "user",
                "content": "Read the file src/main.rs"
            }
        ],
        "tools": [
            {
                "type": "function",
                "function": {
                    "name": "read_file",
                    "description": "Read a file",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "path": { "type": "string", "description": "File path" }
                        },
                        "required": ["path"]
                    }
                }
            }
        ],
        "stream": true,
        "max_tokens": 1024
    });
    
    let client = reqwest::Client::new();
    let mut headers = HeaderMap::new();
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    headers.insert(
        AUTHORIZATION,
        HeaderValue::from_str(&format!("Bearer {}", api_key.trim()))
            .map_err(|e| format!("Invalid API key: {}", e))?,
    );
    
    let url = format!("{}/chat/completions", base_url);
    
    let response = client
        .post(&url)
        .headers(headers)
        .header("accept", "text/event-stream")
        .json(&request)
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;
    
    logs.push(format!("Status: {}", response.status()));
    
    let mut stream = response.bytes_stream();
    let mut chunk_count = 0;
    let mut all_data = String::new();
    
    while let Some(chunk) = stream.next().await {
        match chunk {
            Ok(bytes) => {
                let text = String::from_utf8_lossy(&bytes);
                chunk_count += 1;
                logs.push(format!("\n--- CHUNK {} ---", chunk_count));
                logs.push(text.to_string());
                all_data.push_str(&text);
            }
            Err(e) => {
                logs.push(format!("Stream error: {}", e));
                break;
            }
        }
        
        // Limit chunks to avoid huge output
        if chunk_count >= 50 {
            logs.push(format!("\n... truncated after 50 chunks ..."));
            break;
        }
    }
    
    logs.push(format!("\n=== TOTAL CHUNKS: {} ===", chunk_count));
    
    // Analyze the SSE data
    logs.push(format!("\n=== SSE ANALYSIS ==="));
    for line in all_data.lines() {
        if line.starts_with("data: ") {
            let data = &line[6..];
            if data == "[DONE]" {
                logs.push(format!("Found [DONE] marker"));
            } else if let Ok(parsed) = serde_json::from_str::<Value>(data) {
                if let Some(delta) = parsed.get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("delta")) 
                {
                    if delta.get("tool_calls").is_some() {
                        logs.push(format!("✅ Found tool_calls in delta: {:?}", delta.get("tool_calls")));
                    }
                    if let Some(content) = delta.get("content") {
                        if !content.is_null() {
                            logs.push(format!("Text delta: {:?}", content));
                        }
                    }
                }
                if let Some(finish) = parsed.get("choices")
                    .and_then(|c| c.get(0))
                    .and_then(|c| c.get("finish_reason"))
                {
                    if !finish.is_null() {
                        logs.push(format!("Finish reason: {:?}", finish));
                    }
                }
            }
        }
    }
    
    Ok(logs.join("\n"))
}

/// Debug the full agent flow including tool execution
#[tauri::command]
pub async fn debug_agent_flow(
    api_key: String,
    base_url: String,
    model_id: String,
    project_path: Option<String>,
) -> Result<String, String> {
    let mut logs = Vec::new();
    
    logs.push("=== DEBUG AGENT FLOW ===".to_string());
    logs.push(format!("Model: {}", model_id));
    logs.push(format!("Project path: {:?}", project_path));
    
    // Create agent with tools
    let agent = AIService::create_agent(
        api_key.trim(),
        &base_url,
        model_id.trim(),
        project_path.as_deref(),
    ).map_err(|e| format!("Failed to create agent: {}", e))?;
    
    logs.push("\n=== SENDING MESSAGE ===".to_string());
    logs.push("Message: Create a landing page for a car company in HTML".to_string());
    
    // Run with streaming - testing the problematic prompt
    let mut stream = agent
        .run_streaming(
            "Create a landing page for a car company in HTML. Save it to index.html".to_string(),
            Vec::new(),
        )
        .await
        .map_err(|e| format!("Failed to run agent: {}", e))?;
    
    logs.push("\n=== AGENT EVENTS ===".to_string());
    
    let mut event_count = 0;
    while let Some(event) = stream.next().await {
        event_count += 1;
        match event {
            Ok(AgentEvent::TextDelta(text)) => {
                logs.push(format!("[{}] TextDelta: {}", event_count, text));
            }
            Ok(AgentEvent::ToolStart { name, input }) => {
                logs.push(format!("[{}] ToolStart: {} with input {:?}", event_count, name, input));
            }
            Ok(AgentEvent::ToolResult { name, result, success }) => {
                let result_preview = if result.len() > 200 {
                    format!("{}... ({} chars)", &result[..200], result.len())
                } else {
                    result.clone()
                };
                logs.push(format!("[{}] ToolResult: {} success={} result={}", event_count, name, success, result_preview));
            }
            Ok(AgentEvent::Debug(raw)) => {
                logs.push(format!("[{}] Raw: {}", event_count, raw));
            }
            Ok(AgentEvent::Done { final_text, messages }) => {
                logs.push(format!("[{}] Done: {} messages, final_text: {} chars", event_count, messages.len(), final_text.len()));
                if !final_text.is_empty() {
                    let preview = if final_text.len() > 500 {
                        format!("{}...", &final_text[..500])
                    } else {
                        final_text.clone()
                    };
                    logs.push(format!("Final text: {}", preview));
                }
                break;
            }
            Err(e) => {
                logs.push(format!("[{}] ERROR: {}", event_count, e));
                break;
            }
        }
        
        if event_count >= 100 {
            logs.push("... truncated after 100 events".to_string());
            break;
        }
    }
    
    logs.push(format!("\n=== TOTAL EVENTS: {} ===", event_count));
    
    Ok(logs.join("\n"))
}
