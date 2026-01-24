// LSP Tauri Commands

use crate::lsp::LspManager;
use std::sync::Arc;
use tauri::State;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub struct LspState {
    pub manager: Arc<LspManager>,
}

impl LspState {
    pub fn new() -> Self {
        Self {
            manager: Arc::new(LspManager::new()),
        }
    }
}

#[derive(Serialize, Deserialize)]
pub struct CompletionItem {
    pub label: String,
    pub kind: Option<String>,
    pub detail: Option<String>,
    pub insert_text: Option<String>,
}

#[tauri::command]
pub async fn lsp_set_root(
    state: State<'_, LspState>,
    root_path: String,
) -> Result<(), String> {
    state.manager.set_root_path(root_path).await;
    Ok(())
}

#[tauri::command]
pub async fn lsp_did_open(
    state: State<'_, LspState>,
    path: String,
    content: String,
    language: String,
) -> Result<(), String> {
    state.manager.did_open(&language, &path, &content).await
}

#[tauri::command]
pub async fn lsp_completion(
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    language: String,
) -> Result<Value, String> {
    state.manager.completion(&language, &path, line, character).await
}

#[tauri::command]
pub async fn lsp_hover(
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    language: String,
) -> Result<Value, String> {
    state.manager.hover(&language, &path, line, character).await
}

#[tauri::command]
pub async fn lsp_did_change(
    state: State<'_, LspState>,
    path: String,
    content: String,
    language: String,
) -> Result<(), String> {
    state.manager.did_change(&language, &path, &content).await
}
