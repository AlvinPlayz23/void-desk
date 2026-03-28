// LSP Manager
// Manages the lifecycle of language server processes

use crate::lsp::protocol;
use crate::lsp::transport::LspTransport;
use crate::commands::lsp_runtime;
use lsp_types::{
    GotoDefinitionResponse, OneOf, PublishDiagnosticsParams, ReferenceContext, ReferenceParams,
    RenameParams, TextDocumentPositionParams, Url, WorkspaceEdit,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::{mpsc, RwLock};

const DIAGNOSTICS_EVENT: &str = "lsp://diagnostics";

/// Per-language server state
pub struct LanguageServer {
    pub transport: Arc<LspTransport>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspPosition {
    pub line: u32,
    pub character: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspRange {
    pub start: LspPosition,
    pub end: LspPosition,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspDiagnostic {
    pub path: String,
    pub message: String,
    pub severity: Option<u32>,
    pub source: Option<String>,
    pub code: Option<String>,
    pub range: LspRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DiagnosticEvent {
    pub path: String,
    pub diagnostics: Vec<LspDiagnostic>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LspLocation {
    pub path: String,
    pub range: LspRange,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameFileEdit {
    pub path: String,
    pub range: LspRange,
    pub new_text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RenameResult {
    pub files: Vec<String>,
    pub edits: Vec<RenameFileEdit>,
}

/// Central manager for all language servers
pub struct LspManager {
    servers: RwLock<HashMap<String, Arc<LanguageServer>>>,
    root_path: RwLock<Option<String>>,
    doc_versions: RwLock<HashMap<String, i32>>,
    diagnostics: Arc<RwLock<HashMap<String, Vec<LspDiagnostic>>>>,
    app_handle: Arc<RwLock<Option<AppHandle>>>,
}

impl LspManager {
    pub fn new() -> Self {
        Self {
            servers: RwLock::new(HashMap::new()),
            root_path: RwLock::new(None),
            doc_versions: RwLock::new(HashMap::new()),
            diagnostics: Arc::new(RwLock::new(HashMap::new())),
            app_handle: Arc::new(RwLock::new(None)),
        }
    }

    pub async fn set_app_handle(&self, app_handle: AppHandle) {
        let mut handle = self.app_handle.write().await;
        *handle = Some(app_handle);
    }

    /// Set the workspace root path
    pub async fn set_root_path(&self, path: String) {
        let mut root = self.root_path.write().await;
        *root = Some(path);
        self.diagnostics.write().await.clear();
        self.doc_versions.write().await.clear();
    }

    /// Start a language server if not already running
    pub async fn ensure_server(&self, language: &str) -> Result<Arc<LanguageServer>, String> {
        {
            let servers = self.servers.read().await;
            if let Some(server) = servers.get(language) {
                return Ok(Arc::clone(server));
            }
        }
        let app_handle = self
            .app_handle
            .read()
            .await
            .clone()
            .ok_or_else(|| "LSP app handle is not initialized".to_string())?;

        let resolved = match lsp_runtime::resolve_lsp_command(&app_handle, language) {
            Ok(command) => command,
            Err(error) => return Err(error.to_string()),
        };

        let args_refs: Vec<&str> = resolved.args.iter().map(|arg| arg.as_str()).collect();
        let (notification_tx, notification_rx) = mpsc::unbounded_channel();
        let (transport, _handle) =
            match LspTransport::spawn(&resolved.command, &args_refs, Some(notification_tx)).await {
                Ok(result) => result,
                Err(error) => {
                    let message = format!(
                        "Failed to start LSP server '{}' for {}: {}",
                        resolved.command, language, error
                    );
                    return Err(message);
                }
            };

        let server = Arc::new(LanguageServer {
            transport: Arc::new(transport),
        });

        if let Err(error) = self.initialize_server(&server).await {
            return Err(error);
        }
        self.spawn_notification_handler(notification_rx);

        {
            let mut servers = self.servers.write().await;
            servers.insert(language.to_string(), Arc::clone(&server));
        }

        Ok(server)
    }

    fn spawn_notification_handler(&self, mut notification_rx: mpsc::UnboundedReceiver<Value>) {
        let diagnostics = Arc::clone(&self.diagnostics);
        let app_handle = Arc::clone(&self.app_handle);

        tokio::spawn(async move {
            while let Some(message) = notification_rx.recv().await {
                let method = message.get("method").and_then(|v| v.as_str()).unwrap_or("");
                if method != "textDocument/publishDiagnostics" {
                    continue;
                }

                let Some(params) = message.get("params").cloned() else {
                    continue;
                };

                let Ok(params) = serde_json::from_value::<PublishDiagnosticsParams>(params) else {
                    continue;
                };

                let Ok(path) = uri_to_path(&params.uri) else {
                    continue;
                };

                let converted = params
                    .diagnostics
                    .into_iter()
                    .map(|diagnostic| LspDiagnostic {
                        path: path.clone(),
                        message: diagnostic.message,
                        severity: diagnostic.severity.map(diagnostic_severity_to_u32),
                        source: diagnostic.source,
                        code: diagnostic.code.map(|code| match code {
                            lsp_types::NumberOrString::String(value) => value,
                            lsp_types::NumberOrString::Number(value) => value.to_string(),
                        }),
                        range: to_range(diagnostic.range),
                    })
                    .collect::<Vec<_>>();

                {
                    let mut map = diagnostics.write().await;
                    if converted.is_empty() {
                        map.remove(&path);
                    } else {
                        map.insert(path.clone(), converted.clone());
                    }
                }

                if let Some(app) = app_handle.read().await.clone() {
                    let _ = app.emit(
                        DIAGNOSTICS_EVENT,
                        DiagnosticEvent {
                            path,
                            diagnostics: converted,
                        },
                    );
                }
            }
        });
    }

    /// Send initialize request to the server
    async fn initialize_server(&self, server: &Arc<LanguageServer>) -> Result<(), String> {
        let root_path_guard = self.root_path.read().await;
        let root_path_str = root_path_guard.as_ref().ok_or("No root path set")?;

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
                    "definition": {
                        "linkSupport": true
                    },
                    "references": {
                        "dynamicRegistration": false
                    },
                    "rename": {
                        "dynamicRegistration": false,
                        "prepareSupport": false
                    },
                    "publishDiagnostics": {
                        "relatedInformation": true
                    }
                }
            }
        });

        let _result = server
            .transport
            .send_request("initialize", init_params)
            .await?;

        server
            .transport
            .send_notification("initialized", serde_json::json!({}))?;

        eprintln!("[LSP Manager] Server initialized successfully");
        Ok(())
    }

    /// Request completions at a position
    pub async fn completion(
        &self,
        language: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Value, String> {
        let server = self.ensure_server(language).await?;
        let params = protocol::create_completion_params(path, line, character)?;

        server
            .transport
            .send_request("textDocument/completion", params)
            .await
    }

    /// Request hover info at a position
    pub async fn hover(
        &self,
        language: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Value, String> {
        let server = self.ensure_server(language).await?;
        let params = protocol::create_hover_params(path, line, character)?;

        server
            .transport
            .send_request("textDocument/hover", params)
            .await
    }

    pub async fn definition(
        &self,
        language: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<LspLocation>, String> {
        let server = self.ensure_server(language).await?;
        let params = protocol::create_definition_params(path, line, character)?;
        let result = server
            .transport
            .send_request("textDocument/definition", params)
            .await?;

        if result.is_null() {
            return Ok(Vec::new());
        }

        let response = serde_json::from_value::<GotoDefinitionResponse>(result)
            .map_err(|e| format!("Failed to parse definition response: {}", e))?;

        Ok(match response {
            GotoDefinitionResponse::Scalar(location) => vec![to_location(location)?],
            GotoDefinitionResponse::Array(locations) => locations
                .into_iter()
                .map(to_location)
                .collect::<Result<Vec<_>, _>>()?,
            GotoDefinitionResponse::Link(links) => links
                .into_iter()
                .map(|link| {
                    let path = uri_to_path(&link.target_uri)?;
                    Ok(LspLocation {
                        path,
                        range: to_range(link.target_selection_range),
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
        })
    }

    pub async fn references(
        &self,
        language: &str,
        path: &str,
        line: u32,
        character: u32,
    ) -> Result<Vec<LspLocation>, String> {
        let server = self.ensure_server(language).await?;
        let params = ReferenceParams {
            text_document_position: TextDocumentPositionParams {
                text_document: lsp_types::TextDocumentIdentifier {
                    uri: protocol::path_to_uri(path)?,
                },
                position: lsp_types::Position { line, character },
            },
            context: ReferenceContext {
                include_declaration: true,
            },
            work_done_progress_params: Default::default(),
            partial_result_params: Default::default(),
        };

        let result = server
            .transport
            .send_request(
                "textDocument/references",
                serde_json::to_value(params).map_err(|e| e.to_string())?,
            )
            .await?;

        if result.is_null() {
            return Ok(Vec::new());
        }

        let locations = serde_json::from_value::<Vec<lsp_types::Location>>(result)
            .map_err(|e| format!("Failed to parse references response: {}", e))?;

        locations
            .into_iter()
            .map(to_location)
            .collect::<Result<Vec<_>, _>>()
    }

    pub async fn rename(
        &self,
        language: &str,
        path: &str,
        line: u32,
        character: u32,
        new_name: &str,
    ) -> Result<RenameResult, String> {
        let server = self.ensure_server(language).await?;
        let params = RenameParams {
            text_document_position: TextDocumentPositionParams {
                text_document: lsp_types::TextDocumentIdentifier {
                    uri: protocol::path_to_uri(path)?,
                },
                position: lsp_types::Position { line, character },
            },
            new_name: new_name.to_string(),
            work_done_progress_params: Default::default(),
        };

        let result = server
            .transport
            .send_request(
                "textDocument/rename",
                serde_json::to_value(params).map_err(|e| e.to_string())?,
            )
            .await?;

        if result.is_null() {
            return Ok(RenameResult {
                files: Vec::new(),
                edits: Vec::new(),
            });
        }

        let workspace_edit = serde_json::from_value::<WorkspaceEdit>(result)
            .map_err(|e| format!("Failed to parse rename response: {}", e))?;

        apply_workspace_edit(workspace_edit)
    }

    /// Notify server that a document was opened
    pub async fn did_open(&self, language: &str, path: &str, content: &str) -> Result<(), String> {
        let server = self.ensure_server(language).await?;

        {
            let mut versions = self.doc_versions.write().await;
            versions.insert(path.to_string(), 1);
        }

        let params = protocol::create_did_open_params(path, content, 1)?;

        server
            .transport
            .send_notification("textDocument/didOpen", params)
    }

    /// Notify server that a document changed
    pub async fn did_change(
        &self,
        language: &str,
        path: &str,
        content: &str,
    ) -> Result<(), String> {
        let server = self.ensure_server(language).await?;

        let version = {
            let mut versions = self.doc_versions.write().await;
            let v = versions.entry(path.to_string()).or_insert(0);
            *v += 1;
            *v
        };

        let params = protocol::create_did_change_params(path, content, version)?;

        server
            .transport
            .send_notification("textDocument/didChange", params)
    }

    pub async fn list_diagnostics(&self) -> Vec<LspDiagnostic> {
        let diagnostics = self.diagnostics.read().await;
        diagnostics
            .values()
            .flat_map(|items| items.iter().cloned())
            .collect()
    }
}

impl Default for LspManager {
    fn default() -> Self {
        Self::new()
    }
}

fn to_range(range: lsp_types::Range) -> LspRange {
    LspRange {
        start: LspPosition {
            line: range.start.line,
            character: range.start.character,
        },
        end: LspPosition {
            line: range.end.line,
            character: range.end.character,
        },
    }
}

fn diagnostic_severity_to_u32(severity: lsp_types::DiagnosticSeverity) -> u32 {
    match severity {
        lsp_types::DiagnosticSeverity::ERROR => 1,
        lsp_types::DiagnosticSeverity::WARNING => 2,
        lsp_types::DiagnosticSeverity::INFORMATION => 3,
        lsp_types::DiagnosticSeverity::HINT => 4,
        _ => 2,
    }
}

fn to_location(location: lsp_types::Location) -> Result<LspLocation, String> {
    Ok(LspLocation {
        path: uri_to_path(&location.uri)?,
        range: to_range(location.range),
    })
}

fn uri_to_path(uri: &Url) -> Result<String, String> {
    uri.to_file_path()
        .map_err(|_| format!("Unsupported file URI: {}", uri))
        .map(pathbuf_to_string)
}

fn pathbuf_to_string(path: PathBuf) -> String {
    path.to_string_lossy().to_string()
}

fn apply_workspace_edit(edit: WorkspaceEdit) -> Result<RenameResult, String> {
    let mut per_file: HashMap<String, Vec<RenameFileEdit>> = HashMap::new();

    if let Some(changes) = edit.changes {
        for (uri, text_edits) in changes {
            let path = uri_to_path(&uri)?;
            let entries = per_file.entry(path.clone()).or_default();
            entries.extend(text_edits.into_iter().map(|text_edit| RenameFileEdit {
                path: path.clone(),
                range: to_range(text_edit.range),
                new_text: text_edit.new_text,
            }));
        }
    }

    if let Some(document_changes) = edit.document_changes {
        match document_changes {
            lsp_types::DocumentChanges::Edits(edits) => {
                for document_edit in edits {
                    let path = uri_to_path(&document_edit.text_document.uri)?;
                    let entries = per_file.entry(path.clone()).or_default();

                    for text_edit in document_edit.edits {
                        match text_edit {
                            OneOf::Left(edit) => entries.push(RenameFileEdit {
                                path: path.clone(),
                                range: to_range(edit.range),
                                new_text: edit.new_text,
                            }),
                            OneOf::Right(_) => {
                                return Err("Snippet text edits are not supported".to_string())
                            }
                        }
                    }
                }
            }
            lsp_types::DocumentChanges::Operations(_) => {
                return Err("Resource operations are not supported for rename".to_string())
            }
        }
    }

    let mut files = per_file.keys().cloned().collect::<Vec<_>>();
    files.sort();

    for path in &files {
        let Some(edits) = per_file.get(path) else {
            continue;
        };
        apply_text_edits_to_file(path, edits)?;
    }

    let mut all_edits = per_file
        .into_values()
        .flat_map(|edits| edits.into_iter())
        .collect::<Vec<_>>();
    all_edits.sort_by(|left, right| {
        left.path
            .cmp(&right.path)
            .then(left.range.start.line.cmp(&right.range.start.line))
            .then(left.range.start.character.cmp(&right.range.start.character))
    });

    Ok(RenameResult {
        files,
        edits: all_edits,
    })
}

fn apply_text_edits_to_file(path: &str, edits: &[RenameFileEdit]) -> Result<(), String> {
    let mut content = fs::read_to_string(path).map_err(|e| format!("Failed to read {}: {}", path, e))?;
    let line_offsets = compute_line_offsets(&content);

    let mut ordered = edits.to_vec();
    ordered.sort_by(|left, right| {
        right
            .range
            .start
            .line
            .cmp(&left.range.start.line)
            .then(right.range.start.character.cmp(&left.range.start.character))
            .then(right.range.end.line.cmp(&left.range.end.line))
            .then(right.range.end.character.cmp(&left.range.end.character))
    });

    for edit in ordered {
        let start = position_to_offset(&content, &line_offsets, &edit.range.start)?;
        let end = position_to_offset(&content, &line_offsets, &edit.range.end)?;
        content.replace_range(start..end, &edit.new_text);
    }

    fs::write(path, content).map_err(|e| format!("Failed to write {}: {}", path, e))
}

fn compute_line_offsets(content: &str) -> Vec<usize> {
    let mut offsets = vec![0];
    for (index, ch) in content.char_indices() {
        if ch == '\n' {
            offsets.push(index + 1);
        }
    }
    offsets
}

fn position_to_offset(
    content: &str,
    line_offsets: &[usize],
    position: &LspPosition,
) -> Result<usize, String> {
    let line_index = position.line as usize;
    let Some(line_start) = line_offsets.get(line_index).copied() else {
        return Err(format!("Invalid LSP line {}", position.line));
    };

    let line_end = line_offsets
        .get(line_index + 1)
        .copied()
        .unwrap_or(content.len());
    let line_text = &content[line_start..line_end];

    let mut offset = line_start;
    let mut remaining = position.character as usize;
    for ch in line_text.chars() {
        if remaining == 0 {
            break;
        }
        offset += ch.len_utf8();
        remaining -= 1;
    }

    Ok(offset.min(line_end))
}
