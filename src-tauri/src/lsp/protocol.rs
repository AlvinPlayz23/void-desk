// LSP Protocol Types
// Re-exports and helper types for LSP communication

use lsp_types::{
    InitializeParams, InitializeResult, InitializedParams,
    TextDocumentIdentifier, TextDocumentPositionParams, Position,
    CompletionParams, CompletionResponse, Hover, HoverParams,
    DidOpenTextDocumentParams, DidChangeTextDocumentParams,
    DidSaveTextDocumentParams, DidCloseTextDocumentParams,
    TextDocumentItem, VersionedTextDocumentIdentifier,
    TextDocumentContentChangeEvent, PublishDiagnosticsParams,
    Url,
};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::path::{Path, PathBuf};

/// Canonicalize path if possible, otherwise return as-is (for new unsaved files)
fn canonicalize_if_possible(p: &Path) -> PathBuf {
    std::fs::canonicalize(p).unwrap_or_else(|_| p.to_path_buf())
}

/// Convert file path to URI with proper Windows handling
/// Handles: C:\path -> file:///C:/path (correctly)
pub fn path_to_uri(path: &str) -> Result<Url, String> {
    // If already a file URI, parse it directly
    if path.starts_with("file:") {
        return Url::parse(path).map_err(|e| e.to_string());
    }
    
    // Canonicalize to ensure consistent path representation
    let canonical = canonicalize_if_possible(Path::new(path));
    Url::from_file_path(&canonical).map_err(|_| format!("Invalid path: {}", path))
}

/// Language ID mapping from file extension
pub fn language_id_from_extension(ext: &str) -> &'static str {
    match ext.to_lowercase().as_str() {
        "ts" | "tsx" => "typescript",
        "js" | "jsx" => "javascript",
        "rs" => "rust",
        "py" => "python",
        "html" => "html",
        "css" => "css",
        "json" => "json",
        "md" => "markdown",
        _ => "plaintext",
    }
}

/// Create didOpen params
pub fn create_did_open_params(path: &str, content: &str, version: i32) -> Result<Value, String> {
    let uri = path_to_uri(path)?;
    let ext = path.rsplit('.').next().unwrap_or("");
    let language_id = language_id_from_extension(ext);

    let params = DidOpenTextDocumentParams {
        text_document: TextDocumentItem {
            uri,
            language_id: language_id.to_string(),
            version,
            text: content.to_string(),
        },
    };

    serde_json::to_value(params).map_err(|e| e.to_string())
}

/// Create completion params
pub fn create_completion_params(path: &str, line: u32, character: u32) -> Result<Value, String> {
    let uri = path_to_uri(path)?;
    
    let params = CompletionParams {
        text_document_position: TextDocumentPositionParams {
            text_document: TextDocumentIdentifier { uri },
            position: Position { line, character },
        },
        work_done_progress_params: Default::default(),
        partial_result_params: Default::default(),
        context: None,
    };

    serde_json::to_value(params).map_err(|e| e.to_string())
}

/// Create hover params
pub fn create_hover_params(path: &str, line: u32, character: u32) -> Result<Value, String> {
    let uri = path_to_uri(path)?;
    
    let params = HoverParams {
        text_document_position_params: TextDocumentPositionParams {
            text_document: TextDocumentIdentifier { uri },
            position: Position { line, character },
        },
        work_done_progress_params: Default::default(),
    };

    serde_json::to_value(params).map_err(|e| e.to_string())
}
/// Create didChange params (full content sync for simplicity)
pub fn create_did_change_params(path: &str, content: &str, version: i32) -> Result<Value, String> {
    let uri = path_to_uri(path)?;

    let params = DidChangeTextDocumentParams {
        text_document: VersionedTextDocumentIdentifier {
            uri,
            version,
        },
        content_changes: vec![TextDocumentContentChangeEvent {
            range: None,
            range_length: None,
            text: content.to_string(),
        }],
    };

    serde_json::to_value(params).map_err(|e| e.to_string())
}
