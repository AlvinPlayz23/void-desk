use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State, Emitter};

#[derive(Serialize, Deserialize)]
pub struct PtyInfo {
    pub pid: u32,
}

pub struct TerminalState {
    ptys: Arc<Mutex<HashMap<u32, Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>>>>,
    next_id: Arc<Mutex<u32>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            ptys: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(0)),
        }
    }
}

#[tauri::command]
pub async fn create_pty(
    state: State<'_, TerminalState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<PtyInfo, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Determine shell
    let shell_cmd = if let Some(s) = shell {
        s
    } else {
        #[cfg(target_os = "windows")]
        {
            std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }
    };

    let mut cmd = CommandBuilder::new(shell_cmd);
    // Use app directory as CWD if possible
    if let Ok(cwd) = std::env::current_dir() {
        cmd.cwd(cwd);
    }

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Generate inner ID
    let pid = {
        let mut next_id = state.next_id.lock().unwrap();
        let id = *next_id;
        *next_id += 1;
        id
    };

    let master = Arc::new(Mutex::new(pair.master));

    // Store PTY
    state
        .ptys
        .lock()
        .unwrap()
        .insert(pid, Arc::clone(&master));

    // Spawn reader thread
    let app_clone = app.clone();
    let master_clone = Arc::clone(&master);
    std::thread::spawn(move || {
        let mut reader = master_clone.lock().unwrap().try_clone_reader().unwrap();
        let mut buf = [0u8; 8192];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit(
                        "pty-output",
                        serde_json::json!({
                            "pid": pid,
                            "data": data
                        }),
                    );
                }
                Err(_) => {
                    break;
                }
            }
        }

        // Clean up on exit
        let _ = app_clone.emit(
            "pty-exit",
            serde_json::json!({
                "pid": pid
            }),
        );
    });

    Ok(PtyInfo { pid })
}

#[tauri::command]
pub async fn write_to_pty(
    state: State<'_, TerminalState>,
    pid: u32,
    data: String,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(master) = ptys.get(&pid) {
        let mut master = master.lock().unwrap();
        master
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        master.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err("PTY not found".to_string())
    }
}

#[tauri::command]
pub async fn resize_pty(
    state: State<'_, TerminalState>,
    pid: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(master) = ptys.get(&pid) {
        let master = master.lock().unwrap();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        master
            .resize(size)
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    } else {
        Err("PTY not found".to_string())
    }
}

#[tauri::command]
pub async fn close_pty(state: State<'_, TerminalState>, pid: u32) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    ptys.remove(&pid);
    Ok(())
}
