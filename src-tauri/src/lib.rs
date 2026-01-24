mod commands;
mod lsp;
mod terminal;

use commands::ai_commands;
use commands::file_commands;
use commands::file_watcher;
use commands::lsp_commands;
use commands::project_commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(terminal::TerminalState::new())
        .manage(lsp_commands::LspState::new())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            file_commands::read_file,
            file_commands::write_file,
            file_commands::delete_file,
            file_commands::create_directory,
            file_commands::move_file,
            file_commands::reveal_in_file_explorer,
            project_commands::list_directory,
            project_commands::get_project_tree,
            ai_commands::ask_ai_stream,
            ai_commands::test_ai_connection,
            ai_commands::reset_ai_conversation,
            file_watcher::start_file_watcher,
            file_watcher::stop_file_watcher,
            file_watcher::is_watching,
            terminal::create_pty,
            terminal::write_to_pty,
            terminal::resize_pty,
            terminal::close_pty,
            lsp_commands::lsp_set_root,
            lsp_commands::lsp_did_open,
            lsp_commands::lsp_did_change,
            lsp_commands::lsp_completion,
            lsp_commands::lsp_hover,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
