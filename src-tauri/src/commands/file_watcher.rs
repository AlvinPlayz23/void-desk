//! File system watcher for VoiDesk
//! Watches the project directory and emits events when files change

use notify::{Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use std::path::Path;
use std::sync::Mutex;
use std::time::Duration;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

// Global watcher state
static WATCHER: std::sync::OnceLock<Mutex<Option<WatcherState>>> = std::sync::OnceLock::new();

struct WatcherState {
    _watcher: RecommendedWatcher,
    #[allow(dead_code)]
    watched_path: String,
}

fn get_watcher_state() -> &'static Mutex<Option<WatcherState>> {
    WATCHER.get_or_init(|| Mutex::new(None))
}

#[derive(Clone, serde::Serialize)]
pub struct FileChangeEvent {
    pub event_type: String, // "create", "modify", "remove"
    pub paths: Vec<String>,
}

#[tauri::command]
pub async fn start_file_watcher(app: AppHandle, path: String) -> Result<(), String> {
    // Stop any existing watcher first
    stop_file_watcher_internal()?;

    let watch_path = path.clone();

    // Create a channel for debouncing
    let (tx, mut rx) = mpsc::channel::<Event>(100);

    // Spawn debounce task
    let app_for_emit = app.clone();
    tokio::spawn(async move {
        let mut pending_events: Vec<Event> = Vec::new();
        let debounce_duration = Duration::from_millis(500);

        loop {
            tokio::select! {
                Some(event) = rx.recv() => {
                    pending_events.push(event);
                }
                _ = tokio::time::sleep(debounce_duration), if !pending_events.is_empty() => {
                    // Process accumulated events
                    let mut paths: Vec<String> = Vec::new();
                    let mut event_type = "modify".to_string();

                    for event in pending_events.drain(..) {
                        match event.kind {
                            EventKind::Create(_) => event_type = "create".to_string(),
                            EventKind::Remove(_) => event_type = "remove".to_string(),
                            EventKind::Modify(_) => {},
                            _ => continue,
                        }

                        for path in event.paths {
                            if let Some(p) = path.to_str() {
                                if !paths.contains(&p.to_string()) {
                                    paths.push(p.to_string());
                                }
                            }
                        }
                    }

                    if !paths.is_empty() {
                        let _ = app_for_emit.emit("file-change", FileChangeEvent {
                            event_type,
                            paths,
                        });
                    }
                }
            }
        }
    });

    // Create the watcher
    let tx_clone = tx.clone();
    let mut watcher = RecommendedWatcher::new(
        move |res: Result<Event, notify::Error>| {
            if let Ok(event) = res {
                let _ = tx_clone.blocking_send(event);
            }
        },
        Config::default(),
    )
    .map_err(|e| format!("Failed to create watcher: {}", e))?;

    // Start watching
    watcher
        .watch(Path::new(&watch_path), RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch path: {}", e))?;

    // Store the watcher
    let mut state = get_watcher_state().lock().map_err(|e| e.to_string())?;
    *state = Some(WatcherState {
        _watcher: watcher,
        watched_path: path,
    });

    Ok(())
}

fn stop_file_watcher_internal() -> Result<(), String> {
    let mut state = get_watcher_state().lock().map_err(|e| e.to_string())?;
    *state = None;
    Ok(())
}

#[tauri::command]
pub async fn stop_file_watcher() -> Result<(), String> {
    stop_file_watcher_internal()
}

#[tauri::command]
pub async fn is_watching() -> Result<bool, String> {
    let state = get_watcher_state().lock().map_err(|e| e.to_string())?;
    Ok(state.is_some())
}

