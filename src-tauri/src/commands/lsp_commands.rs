// LSP Tauri Commands

use crate::lsp::LspManager;
use crate::lsp::manager::{LspDiagnostic, LspLocation, RenameResult};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::sync::Arc;
use tauri::State;

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
pub async fn lsp_list_diagnostics(state: State<'_, LspState>) -> Result<Vec<LspDiagnostic>, String> {
    Ok(state.manager.list_diagnostics().await)
}

#[tauri::command]
pub async fn lsp_set_root(state: State<'_, LspState>, root_path: String) -> Result<(), String> {
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
    state
        .manager
        .completion(&language, &path, line, character)
        .await
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

#[tauri::command]
pub async fn lsp_definition(
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    language: String,
) -> Result<Vec<LspLocation>, String> {
    state
        .manager
        .definition(&language, &path, line, character)
        .await
}

#[tauri::command]
pub async fn lsp_references(
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    language: String,
) -> Result<Vec<LspLocation>, String> {
    state
        .manager
        .references(&language, &path, line, character)
        .await
}

#[tauri::command]
pub async fn lsp_rename(
    state: State<'_, LspState>,
    path: String,
    line: u32,
    character: u32,
    language: String,
    new_name: String,
) -> Result<RenameResult, String> {
    state
        .manager
        .rename(&language, &path, line, character, &new_name)
        .await
}
