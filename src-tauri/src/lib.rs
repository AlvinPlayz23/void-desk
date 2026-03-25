mod commands;
mod lsp;
mod sdk;
mod terminal;
mod tracing_setup;

use tauri::Manager;

use commands::ai_commands;
use commands::ai_debug;
use commands::ai_service;
use commands::attachment_commands;
use commands::chat_storage;
use commands::codex_auth;
use commands::file_commands;
use commands::file_watcher;
use commands::lsp_commands;
use commands::project_commands;
use commands::search_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_setup::init_logging();
    tauri::Builder::default()
        .manage(terminal::TerminalState::new())
        .manage(lsp_commands::LspState::new())
        .setup(|app| {
            let chat_storage_state = chat_storage::ChatStorageState::new(app.handle())?;
            let ai_service_state =
                ai_service::AIService::from_db_path(chat_storage_state.db_path().to_path_buf())?;
            let codex_auth_state = codex_auth::CodexAuthState::new(app.handle())?;
            app.manage(chat_storage_state);
            app.manage(ai_service_state);
            app.manage(codex_auth_state);
            Ok(())
        })
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            // File operations
            file_commands::read_file,
            file_commands::write_file,
            file_commands::delete_file,
            file_commands::create_directory,
            file_commands::move_file,
            file_commands::reveal_in_file_explorer,
            file_commands::rename_file,
            file_commands::batch_delete_files,
            file_commands::batch_move_files,
            // Project operations
            project_commands::list_directory,
            project_commands::get_project_tree,
            // AI operations
            ai_commands::ask_ai_stream,
            ai_commands::ask_ai_stream_with_session,
            ai_commands::cancel_ai_stream,
            ai_commands::test_ai_connection,
            ai_commands::reset_ai_conversation,
            ai_commands::get_inline_completion,
            ai_commands::create_chat_session,
            ai_commands::list_chat_sessions,
            ai_commands::delete_chat_session,
            ai_commands::rename_chat_session,
            codex_auth::codex_auth_status,
            codex_auth::codex_start_login,
            codex_auth::codex_logout,
            // Durable chat storage
            chat_storage::load_chat_state,
            chat_storage::save_chat_state,
            // AI Debug
            ai_debug::debug_tool_call,
            ai_debug::debug_stream_response,
            ai_debug::debug_agent_flow,
            // Search
            search_commands::search_in_files,
            search_commands::replace_in_files,
            // File watcher
            file_watcher::start_file_watcher,
            file_watcher::stop_file_watcher,
            file_watcher::is_watching,
            // Terminal
            terminal::create_pty,
            terminal::write_to_pty,
            terminal::resize_pty,
            terminal::close_pty,
            // Attachments
            attachment_commands::prepare_chat_attachments,
            // LSP
            lsp_commands::lsp_set_root,
            lsp_commands::lsp_did_open,
            lsp_commands::lsp_did_change,
            lsp_commands::lsp_completion,
            lsp_commands::lsp_hover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
