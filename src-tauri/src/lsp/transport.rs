// LSP Transport Layer
// Handles JSON-RPC message framing over stdin/stdout with proper request/response routing

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{ChildStdin, ChildStdout, Stdio};
use std::sync::Arc;
use tokio::sync::{mpsc, oneshot, Mutex};
use serde_json::Value;

/// Sender for stdin writes (thread-safe)
pub struct StdinWriter {
    stdin: std::sync::Mutex<ChildStdin>,
}

impl StdinWriter {
    fn new(stdin: ChildStdin) -> Self {
        Self {
            stdin: std::sync::Mutex::new(stdin),
        }
    }

    pub fn write_message(&self, message: &Value) -> Result<(), String> {
        let content = serde_json::to_string(message).map_err(|e| e.to_string())?;
        let header = format!("Content-Length: {}\r\n\r\n", content.len());

        let mut stdin = self.stdin.lock().map_err(|e| e.to_string())?;
        stdin.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
        stdin.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        stdin.flush().map_err(|e| e.to_string())?;

        Ok(())
    }
}

/// LSP Transport with proper request/response routing
pub struct LspTransport {
    writer: Arc<StdinWriter>,
    pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
    next_id: Mutex<u64>,
}

impl StdinWriter {
    /// Send a response to a server request
    pub fn send_response(&self, id: Value, result: Value) -> Result<(), String> {
        let response = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": result
        });
        self.write_message(&response)
    }
}

impl LspTransport {
    /// Spawns a new language server process and sets up communication
    pub async fn spawn(command: &str, args: &[&str]) -> Result<(Self, tokio::task::JoinHandle<()>), String> {
        let mut cmd = if cfg!(windows) && !command.ends_with(".exe") {
            let mut c = std::process::Command::new("cmd");
            c.arg("/C").arg(command);
            c
        } else {
            std::process::Command::new(command)
        };

        let mut child = cmd
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to spawn LSP ({}): {}", command, e))?;

        let stdin = child.stdin.take().ok_or("Failed to capture stdin")?;
        let stdout = child.stdout.take().ok_or("Failed to capture stdout")?;

        let writer = Arc::new(StdinWriter::new(stdin));
        let pending_requests: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>> = 
            Arc::new(Mutex::new(HashMap::new()));

        // Clone for the background reader
        let pending_clone = Arc::clone(&pending_requests);
        let writer_clone = Arc::clone(&writer);

        // Spawn a background task to read all responses and route them
        let handle = tokio::task::spawn_blocking(move || {
            let reader = BufReader::new(stdout);
            Self::read_loop(reader, pending_clone, writer_clone);
        });

        Ok((
            Self {
                writer,
                pending_requests,
                next_id: Mutex::new(1),
            },
            handle,
        ))
    }

    /// Background reader that routes responses to waiting requests
    fn read_loop(
        mut reader: BufReader<ChildStdout>, 
        pending: Arc<Mutex<HashMap<u64, oneshot::Sender<Value>>>>,
        writer: Arc<StdinWriter>
    ) {
        loop {
            // Read Content-Length header
            let mut header_line = String::new();
            if reader.read_line(&mut header_line).unwrap_or(0) == 0 {
                eprintln!("[LSP Transport] Reader loop ended - no more data");
                break;
            }

            let content_length: usize = if header_line.starts_with("Content-Length:") {
                header_line
                    .trim_start_matches("Content-Length:")
                    .trim()
                    .parse()
                    .unwrap_or(0)
            } else {
                continue;
            };

            // Skip empty line (and any other headers like Content-Type)
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).unwrap_or(0) == 0 {
                    break;
                }
                if line.trim().is_empty() {
                    break;
                }
            }

            // Read the JSON body
            let mut body = vec![0u8; content_length];
            if reader.read_exact(&mut body).is_err() {
                eprintln!("[LSP Transport] Failed to read body");
                break;
            }

            if let Ok(json) = serde_json::from_slice::<Value>(&body) {
                let has_id = json.get("id").is_some();
                let has_method = json.get("method").is_some();

                if has_id && !has_method {
                    // This is a response to our request
                    if let Some(id) = json.get("id").and_then(|v| v.as_u64()) {
                        let sender = {
                            let rt = tokio::runtime::Handle::try_current();
                            if let Ok(handle) = rt {
                                handle.block_on(async {
                                    pending.lock().await.remove(&id)
                                })
                            } else {
                                eprintln!("[LSP Transport] No tokio runtime for routing response id: {}", id);
                                None
                            }
                        };

                        if let Some(tx) = sender {
                            eprintln!("[LSP Transport] Routing response for id: {}", id);
                            let _ = tx.send(json);
                        } else {
                            eprintln!("[LSP Transport] No pending request for id: {}", id);
                        }
                    }
                } else if has_id && has_method {
                    // Request from server - we need to respond!
                    let method = json.get("method").and_then(|v| v.as_str()).unwrap_or("");
                    let id = json.get("id").cloned().unwrap_or(Value::Null);
                    
                    eprintln!("[LSP Transport] Server request: {} (id: {})", method, id);
                    
                    // Handle common server requests
                    let response_result = match method {
                        "workspace/configuration" => {
                            // Return empty configuration for each requested item
                            // The server sends an array of items it wants config for
                            if let Some(items) = json.get("params").and_then(|p| p.get("items")).and_then(|i| i.as_array()) {
                                // Return an empty object for each config item requested
                                let configs: Vec<Value> = items.iter().map(|_| serde_json::json!({})).collect();
                                serde_json::json!(configs)
                            } else {
                                serde_json::json!([{}])
                            }
                        }
                        "client/registerCapability" => {
                            // Accept capability registration
                            serde_json::json!(null)
                        }
                        "window/workDoneProgress/create" => {
                            // Accept progress token creation
                            serde_json::json!(null)
                        }
                        _ => {
                            eprintln!("[LSP Transport] Unhandled server request: {}", method);
                            serde_json::json!(null)
                        }
                    };
                    
                    // Send response
                    if let Err(e) = writer.send_response(id, response_result) {
                        eprintln!("[LSP Transport] Failed to send response: {}", e);
                    }
                } else {
                    // Notification from server (no id, has method)
                    if let Some(method) = json.get("method").and_then(|v| v.as_str()) {
                        eprintln!("[LSP Transport] Notification: {}", method);
                    }
                }
            }
        }
    }

    /// Sends a JSON-RPC request and waits for the response
    pub async fn send_request(&self, method: &str, params: Value) -> Result<Value, String> {
        let id = {
            let mut next = self.next_id.lock().await;
            let id = *next;
            *next += 1;
            id
        };

        // Create a oneshot channel for the response
        let (tx, rx) = oneshot::channel();

        // Register the pending request
        {
            let mut pending = self.pending_requests.lock().await;
            pending.insert(id, tx);
        }

        // Build and send the request
        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        eprintln!("[LSP Transport] Sending request id: {}, method: {}", id, method);
        self.writer.write_message(&request)?;

        // Wait for response with timeout
        match tokio::time::timeout(std::time::Duration::from_secs(10), rx).await {
            Ok(Ok(response)) => {
                eprintln!("[LSP Transport] Got response for id: {}", id);
                // Extract result or error
                if let Some(result) = response.get("result") {
                    Ok(result.clone())
                } else if let Some(error) = response.get("error") {
                    Err(format!("LSP error: {:?}", error))
                } else {
                    Ok(Value::Null)
                }
            }
            Ok(Err(_)) => {
                // Channel closed
                self.pending_requests.lock().await.remove(&id);
                Err("Response channel closed".to_string())
            }
            Err(_) => {
                // Timeout
                self.pending_requests.lock().await.remove(&id);
                eprintln!("[LSP Transport] Request timed out for id: {}", id);
                Err("Request timed out".to_string())
            }
        }
    }

    /// Sends a JSON-RPC notification (no response expected)
    pub fn send_notification(&self, method: &str, params: Value) -> Result<(), String> {
        let notification = serde_json::json!({
            "jsonrpc": "2.0",
            "method": method,
            "params": params
        });

        eprintln!("[LSP Transport] Sending notification: {}", method);
        self.writer.write_message(&notification)
    }
}
