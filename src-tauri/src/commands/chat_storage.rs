use anyhow::{Context, Result};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager, State};

const CHAT_STATE_ROW_ID: i64 = 1;
const CHAT_STATE_DB_FILE: &str = "chat_state.sqlite";

pub struct ChatStorageState {
    db_path: PathBuf,
}

impl ChatStorageState {
    pub fn new(app: &AppHandle) -> Result<Self> {
        let data_dir = app
            .path()
            .app_data_dir()
            .context("failed to resolve app data directory")?;

        fs::create_dir_all(&data_dir).with_context(|| {
            format!(
                "failed to create app data directory at {}",
                data_dir.display()
            )
        })?;

        let db_path = data_dir.join(CHAT_STATE_DB_FILE);
        initialize_database(&db_path)?;

        Ok(Self { db_path })
    }

    pub fn db_path(&self) -> &Path {
        &self.db_path
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct PersistedChatState {
    #[serde(default)]
    pub sessions: Vec<PersistedChatSession>,
    #[serde(rename = "activeSessionId", default)]
    pub active_session_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct PersistedChatSession {
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub messages: Vec<PersistedMessage>,
    #[serde(rename = "contextPaths", default)]
    pub context_paths: Vec<String>,
    #[serde(rename = "workspacePath", default)]
    pub workspace_path: Option<String>,
    #[serde(rename = "debugLogs", default)]
    pub debug_logs: Vec<PersistedDebugLog>,
    #[serde(rename = "createdAt")]
    pub created_at: i64,
    #[serde(rename = "lastUpdated")]
    pub last_updated: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedMessage {
    pub id: String,
    pub role: String,
    pub content: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool_call: Option<String>,
    #[serde(rename = "toolOperations", skip_serializing_if = "Option::is_none")]
    pub tool_operations: Option<Vec<PersistedToolOperation>>,
    #[serde(default)]
    pub parts: Vec<PersistedMessagePart>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub attachments: Option<Vec<serde_json::Value>>,
    pub timestamp: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum PersistedMessagePart {
    Text {
        text: String,
    },
    Tool {
        id: String,
        #[serde(rename = "toolOperation")]
        tool_operation: PersistedToolOperation,
    },
    Reasoning {
        text: String,
        #[serde(rename = "innerTools", skip_serializing_if = "Option::is_none")]
        inner_tools: Option<Vec<PersistedReasoningInnerTool>>,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedReasoningInnerTool {
    pub id: String,
    #[serde(rename = "toolOperation")]
    pub tool_operation: PersistedToolOperation,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedToolOperation {
    pub operation: String,
    pub target: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PersistedDebugLog {
    pub timestamp: i64,
    pub r#type: String,
    pub message: String,
}

#[tauri::command]
pub fn load_chat_state(storage: State<'_, ChatStorageState>) -> Result<PersistedChatState, String> {
    load_state(&storage.db_path).map_err(|error| error.to_string())
}

#[tauri::command]
pub fn save_chat_state(
    state: PersistedChatState,
    storage: State<'_, ChatStorageState>,
) -> Result<(), String> {
    save_state(&storage.db_path, state).map_err(|error| error.to_string())
}

fn initialize_database(db_path: &Path) -> Result<()> {
    let connection = open_connection(db_path)?;
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS chat_state (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            state_json TEXT NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#,
    )?;
    Ok(())
}

fn open_connection(db_path: &Path) -> Result<Connection> {
    let connection = Connection::open(db_path)
        .with_context(|| format!("failed to open chat database at {}", db_path.display()))?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        "#,
    )?;
    Ok(connection)
}

fn load_state(db_path: &Path) -> Result<PersistedChatState> {
    initialize_database(db_path)?;

    let connection = open_connection(db_path)?;
    let raw_state = connection
        .query_row(
            "SELECT state_json FROM chat_state WHERE id = ?1",
            params![CHAT_STATE_ROW_ID],
            |row| row.get::<_, String>(0),
        )
        .optional()?;

    match raw_state {
        Some(raw_state) => {
            serde_json::from_str(&raw_state).context("failed to deserialize persisted chat state")
        }
        None => Ok(PersistedChatState::default()),
    }
}

fn save_state(db_path: &Path, state: PersistedChatState) -> Result<()> {
    initialize_database(db_path)?;

    let sanitized_state = strip_attachments(state);
    let payload = serde_json::to_string(&sanitized_state)
        .context("failed to serialize persisted chat state")?;
    let updated_at = current_unix_timestamp_ms();

    let mut connection = open_connection(db_path)?;
    let transaction = connection.transaction()?;
    transaction.execute(
        r#"
        INSERT INTO chat_state (id, state_json, updated_at)
        VALUES (?1, ?2, ?3)
        ON CONFLICT(id) DO UPDATE SET
            state_json = excluded.state_json,
            updated_at = excluded.updated_at
        "#,
        params![CHAT_STATE_ROW_ID, payload, updated_at],
    )?;
    transaction.commit()?;

    Ok(())
}

fn strip_attachments(mut state: PersistedChatState) -> PersistedChatState {
    for session in &mut state.sessions {
        for message in &mut session.messages {
            message.attachments = None;
        }
    }

    state
}

fn current_unix_timestamp_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

#[cfg(test)]
mod tests {
    use super::{
        load_state, save_state, PersistedChatSession, PersistedChatState, PersistedDebugLog,
        PersistedMessage, PersistedMessagePart, PersistedReasoningInnerTool,
        PersistedToolOperation,
    };
    use std::env;

    fn temp_db_path(label: &str) -> std::path::PathBuf {
        env::temp_dir().join(format!(
            "voiddesk-chat-storage-{label}-{}.sqlite",
            uuid::Uuid::new_v4()
        ))
    }

    #[test]
    fn save_and_load_round_trip_strips_attachments() {
        let db_path = temp_db_path("round-trip");
        let tool_operation = PersistedToolOperation {
            operation: "read_file".to_string(),
            target: "src/main.ts".to_string(),
            status: "completed".to_string(),
            details: Some("ok".to_string()),
        };

        let state = PersistedChatState {
            sessions: vec![PersistedChatSession {
                id: "session-1".to_string(),
                name: "Session 1".to_string(),
                messages: vec![PersistedMessage {
                    id: "message-1".to_string(),
                    role: "user".to_string(),
                    content: "hello".to_string(),
                    tool_call: None,
                    tool_operations: Some(vec![tool_operation.clone()]),
                    parts: vec![
                        PersistedMessagePart::Text {
                            text: "hello".to_string(),
                        },
                        PersistedMessagePart::Tool {
                            id: "tool-1".to_string(),
                            tool_operation: tool_operation.clone(),
                        },
                        PersistedMessagePart::Reasoning {
                            text: "thinking".to_string(),
                            inner_tools: Some(vec![PersistedReasoningInnerTool {
                                id: "inner-1".to_string(),
                                tool_operation,
                            }]),
                        },
                    ],
                    attachments: Some(vec![serde_json::json!({
                        "id": "attachment-1",
                        "kind": "image",
                        "dataUrl": "data:image/png;base64,abc"
                    })]),
                    timestamp: 123,
                }],
                context_paths: vec!["src/main.ts".to_string()],
                workspace_path: Some("C:/workspace".to_string()),
                debug_logs: vec![PersistedDebugLog {
                    timestamp: 456,
                    r#type: "info".to_string(),
                    message: "saved".to_string(),
                }],
                created_at: 111,
                last_updated: 222,
            }],
            active_session_id: Some("session-1".to_string()),
        };

        save_state(&db_path, state).expect("save should succeed");
        let loaded = load_state(&db_path).expect("load should succeed");

        assert_eq!(loaded.active_session_id.as_deref(), Some("session-1"));
        assert_eq!(loaded.sessions.len(), 1);
        assert_eq!(loaded.sessions[0].messages.len(), 1);
        assert_eq!(loaded.sessions[0].messages[0].attachments, None);
        assert_eq!(loaded.sessions[0].debug_logs.len(), 1);

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(db_path.with_extension("sqlite-shm"));
    }

    #[test]
    fn load_without_row_returns_empty_state() {
        let db_path = temp_db_path("empty");
        let loaded = load_state(&db_path).expect("load should succeed");

        assert!(loaded.sessions.is_empty());
        assert_eq!(loaded.active_session_id, None);

        let _ = std::fs::remove_file(&db_path);
        let _ = std::fs::remove_file(db_path.with_extension("sqlite-wal"));
        let _ = std::fs::remove_file(db_path.with_extension("sqlite-shm"));
    }
}
