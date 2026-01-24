// LSP Manager
// Manages the lifecycle of language server processes

use crate::lsp::transport::LspTransport;
use crate::lsp::protocol;
use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;
use tokio::sync::RwLock;
use serde_json::Value;
use lsp_types::Url;

/// Per-language server state
pub struct LanguageServer {
    pub transport: Arc<LspTransport>,
}

/// Central manager for all language servers
pub struct LspManager {
    servers: RwLock<HashMap<String, Arc<LanguageServer>>>,
    root_path: RwLock<Option<String>>,
    doc_versions: RwLock<HashMap<String, i32>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            servers: RwLock::new(HashMap::new()),
            root_path: RwLock::new(None),
            doc_versions: RwLock::new(HashMap::new()),
        }
    }

    /// Set the workspace root path
    pub async fn set_root_path(&self, path: String) {
        let mut root = self.root_path.write().await;
        *root = Some(path);
    }

    /// Get server command for a language
    fn get_server_command(language: &str) -> Option<(&'static str, Vec<&'static str>)> {
        match language {
            "typescript" | "javascript" => {
                Some(("typescript-language-server", vec!["--stdio"]))
            }
            "rust" => Some(("rust-analyzer", vec![])),
            "python" => Some(("pyright-langserver", vec!["--stdio"])),
            _ => None,
        }
    }

    /// Start a language server if not already running
    pub async fn ensure_server(&self, language: &str) -> Result<Arc<LanguageServer>, String> {
        // Check if already running
        {
            let servers = self.servers.read().await;
            if let Some(server) = servers.get(language) {
                return Ok(Arc::clone(server));
            }
        }

        // Get command for this language
        let (cmd, args) = Self::get_server_command(language)
            .ok_or_else(|| format!("No language server for: {}", language))?;

        // Spawn the server
        let args_refs: Vec<&str> = args.iter().map(|s| *s).collect();
        let (transport, _handle) = LspTransport::spawn(cmd, &args_refs).await?;

        let server = Arc::new(LanguageServer {
            transport: Arc::new(transport),
        });

        // Initialize the server
        self.initialize_server(&server, language).await?;

        // Store it
        {
            let mut servers = self.servers.write().await;
            servers.insert(language.to_string(), Arc::clone(&server));
        }

        Ok(server)
    }

    /// Send initialize request to the server
    async fn initialize_server(&self, server: &Arc<LanguageServer>, _language: &str) -> Result<(), String> {
        let root_path_guard = self.root_path.read().await;
        let root_path_str = root_path_guard.as_ref()
            .ok_or("No root path set")?;

        // Properly convert Windows path to file:/// URI using lsp_types::Url
        let root_url = Url::from_directory_path(Path::new(root_path_str))
            .map_err(|_| format!("Invalid root path: {}", root_path_str))?;
        
        let workspace_name = Path::new(root_path_str)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("workspace")
            .to_string();

        let init_params = serde_json::json!({
            "processId": std::process::id(),
            "rootUri": root_url.to_string(),
            "rootPath": root_path_str,
            "workspaceFolders": [{
                "uri": root_url.to_string(),
                "name": workspace_name
            }],
            "capabilities": {
                "workspace": {
                    "workspaceFolders": true,
                    "configuration": true
                },
                "textDocument": {
                    "synchronization": {
                        "didSave": true,
                        "willSave": false,
                        "willSaveWaitUntil": false,
                        "dynamicRegistration": false
                    },
                    "completion": {
                        "completionItem": {
                            "snippetSupport": true,
                            "documentationFormat": ["markdown", "plaintext"],
                            "deprecatedSupport": true,
                            "labelDetailsSupport": true
                        },
                        "contextSupport": true
                    },
                    "hover": {
                        "contentFormat": ["markdown", "plaintext"]
                    },
                    "publishDiagnostics": {
                        "relatedInformation": true
                    }
                }
            }
        });

        // Send initialize request and wait for response
        let _result = server.transport.send_request("initialize", init_params).await?;
        
        // Send initialized notification
        server.transport.send_notification("initialized", serde_json::json!({}))?;
        
        eprintln!("[LSP Manager] Server initialized successfully");
        Ok(())
    }

    /// Request completions at a position
    pub async fn completion(&self, language: &str, path: &str, line: u32, character: u32) -> Result<Value, String> {
        let server = self.ensure_server(language).await?;
        let params = protocol::create_completion_params(path, line, character)?;

        eprintln!("[LSP Manager] Requesting completion at {}:{}:{}", path, line, character);
        server.transport.send_request("textDocument/completion", params).await
    }

    /// Request hover info at a position
    pub async fn hover(&self, language: &str, path: &str, line: u32, character: u32) -> Result<Value, String> {
        let server = self.ensure_server(language).await?;
        let params = protocol::create_hover_params(path, line, character)?;

        server.transport.send_request("textDocument/hover", params).await
    }

    /// Notify server that a document was opened
    pub async fn did_open(&self, language: &str, path: &str, content: &str) -> Result<(), String> {
        let server = self.ensure_server(language).await?;
        
        // Reset version for new open
        {
            let mut versions = self.doc_versions.write().await;
            versions.insert(path.to_string(), 1);
        }

        let params = protocol::create_did_open_params(path, content, 1)?;

        server.transport.send_notification("textDocument/didOpen", params)
    }

    /// Notify server that a document changed
    pub async fn did_change(&self, language: &str, path: &str, content: &str) -> Result<(), String> {
        let server = self.ensure_server(language).await?;
        
        let version = {
            let mut versions = self.doc_versions.write().await;
            let v = versions.entry(path.to_string()).or_insert(0);
            *v += 1;
            *v
        };

        let params = protocol::create_did_change_params(path, content, version)?;

        server.transport.send_notification("textDocument/didChange", params)
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}
