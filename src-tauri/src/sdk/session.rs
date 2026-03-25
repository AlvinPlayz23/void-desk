//! Session store for conversation history

use anyhow::{Context, Result};
use chrono::{DateTime, TimeZone, Utc};
use rusqlite::{params, Connection};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::RwLock;
use tracing::error;
use uuid::Uuid;

use crate::sdk::core::Message;

const SESSION_TABLE_NAME: &str = "agent_sessions";

/// A conversation session
#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub name: Option<String>,
    pub messages: Vec<Message>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Default)]
struct SessionPersistence {
    db_path: Option<PathBuf>,
}

impl SessionPersistence {
    fn disabled() -> Self {
        Self { db_path: None }
    }

    fn enabled(db_path: PathBuf) -> Result<Self> {
        initialize_database(&db_path)?;
        Ok(Self {
            db_path: Some(db_path),
        })
    }

    fn load_sessions(&self) -> Result<HashMap<String, Session>> {
        let Some(db_path) = &self.db_path else {
            return Ok(HashMap::new());
        };

        let connection = open_connection(db_path)?;
        let mut statement = connection.prepare(&format!(
            "SELECT id, name, messages_json, created_at, updated_at FROM {SESSION_TABLE_NAME}"
        ))?;
        let rows = statement.query_map([], |row| {
            let id: String = row.get(0)?;
            let name: Option<String> = row.get(1)?;
            let messages_json: String = row.get(2)?;
            let created_at: i64 = row.get(3)?;
            let updated_at: i64 = row.get(4)?;
            let messages = serde_json::from_str::<Vec<Message>>(&messages_json).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    messages_json.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })?;

            Ok(Session {
                id: id.clone(),
                name,
                messages,
                created_at: timestamp_millis_to_utc(created_at),
                updated_at: timestamp_millis_to_utc(updated_at),
            })
        })?;

        let mut sessions = HashMap::new();
        for row in rows {
            let session = row?;
            sessions.insert(session.id.clone(), session);
        }

        Ok(sessions)
    }

    fn save_session(&self, session: &Session) -> Result<()> {
        let Some(db_path) = &self.db_path else {
            return Ok(());
        };

        let connection = open_connection(db_path)?;
        let messages_json =
            serde_json::to_string(&session.messages).context("failed to serialize session messages")?;
        connection.execute(
            &format!(
                r#"
                INSERT INTO {SESSION_TABLE_NAME} (id, name, messages_json, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    messages_json = excluded.messages_json,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at
                "#
            ),
            params![
                session.id,
                session.name,
                messages_json,
                session.created_at.timestamp_millis(),
                session.updated_at.timestamp_millis()
            ],
        )?;

        Ok(())
    }

    fn delete_session(&self, id: &str) -> Result<()> {
        let Some(db_path) = &self.db_path else {
            return Ok(());
        };

        let connection = open_connection(db_path)?;
        connection.execute(
            &format!("DELETE FROM {SESSION_TABLE_NAME} WHERE id = ?1"),
            params![id],
        )?;
        Ok(())
    }
}

/// Session store for conversation history.
/// When created with a database path it keeps a memory cache backed by SQLite.
pub struct SessionStore {
    sessions: RwLock<HashMap<String, Session>>,
    persistence: SessionPersistence,
}

impl Default for SessionStore {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
            persistence: SessionPersistence::disabled(),
        }
    }

    pub fn from_db_path(db_path: PathBuf) -> Result<Self> {
        let persistence = SessionPersistence::enabled(db_path)?;
        let sessions = persistence.load_sessions()?;

        Ok(Self {
            sessions: RwLock::new(sessions),
            persistence,
        })
    }

    pub async fn create(&self, id: Option<String>, name: Option<String>) -> Session {
        let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());

        let mut sessions = self.sessions.write().await;
        if let Some(existing) = sessions.get(&id) {
            return existing.clone();
        }

        let now = Utc::now();
        let session = Session {
            id: id.clone(),
            name,
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
        };

        sessions.insert(id, session.clone());
        drop(sessions);

        self.persist_session(&session);
        session
    }

    pub async fn get(&self, id: &str) -> Option<Session> {
        let sessions = self.sessions.read().await;
        sessions.get(id).cloned()
    }

    pub async fn list(&self) -> Vec<Session> {
        let sessions = self.sessions.read().await;
        sessions.values().cloned().collect()
    }

    pub async fn append(&self, id: &str, message: Message) {
        let session = {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .entry(id.to_string())
                .or_insert_with(|| empty_session(id.to_string()));
            session.messages.push(message);
            session.updated_at = Utc::now();
            session.clone()
        };

        self.persist_session(&session);
    }

    pub async fn append_many(&self, id: &str, messages: Vec<Message>) {
        let session = {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .entry(id.to_string())
                .or_insert_with(|| empty_session(id.to_string()));
            session.messages.extend(messages);
            session.updated_at = Utc::now();
            session.clone()
        };

        self.persist_session(&session);
    }

    pub async fn replace_messages(&self, id: &str, messages: Vec<Message>) {
        let session = {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .entry(id.to_string())
                .or_insert_with(|| empty_session(id.to_string()));
            session.messages = messages;
            session.updated_at = Utc::now();
            session.clone()
        };

        self.persist_session(&session);
    }

    pub async fn set_name(&self, id: &str, name: Option<String>) {
        let maybe_session = {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(id) {
                session.name = name;
                session.updated_at = Utc::now();
                Some(session.clone())
            } else {
                None
            }
        };

        if let Some(session) = maybe_session {
            self.persist_session(&session);
        }
    }

    pub async fn clear(&self, id: &str) {
        let maybe_session = {
            let mut sessions = self.sessions.write().await;
            if let Some(session) = sessions.get_mut(id) {
                session.messages.clear();
                session.updated_at = Utc::now();
                Some(session.clone())
            } else {
                None
            }
        };

        if let Some(session) = maybe_session {
            self.persist_session(&session);
        }
    }

    pub async fn delete(&self, id: &str) {
        let removed = {
            let mut sessions = self.sessions.write().await;
            sessions.remove(id).is_some()
        };

        if removed {
            self.delete_persisted_session(id);
        }
    }

    fn persist_session(&self, session: &Session) {
        if let Err(error) = self.persistence.save_session(session) {
            error!(
                "Failed to persist session {} to SQLite: {}",
                session.id, error
            );
        }
    }

    fn delete_persisted_session(&self, id: &str) {
        if let Err(error) = self.persistence.delete_session(id) {
            error!("Failed to delete session {} from SQLite: {}", id, error);
        }
    }
}

fn empty_session(id: String) -> Session {
    let now = Utc::now();
    Session {
        id,
        name: None,
        messages: Vec::new(),
        created_at: now,
        updated_at: now,
    }
}

fn initialize_database(db_path: &Path) -> Result<()> {
    let connection = open_connection(db_path)?;
    connection.execute_batch(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS {SESSION_TABLE_NAME} (
            id TEXT PRIMARY KEY,
            name TEXT NULL,
            messages_json TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        );
        "#
    ))?;
    Ok(())
}

fn open_connection(db_path: &Path) -> Result<Connection> {
    let connection = Connection::open(db_path)
        .with_context(|| format!("failed to open session database at {}", db_path.display()))?;
    connection.busy_timeout(Duration::from_secs(5))?;
    connection.execute_batch(
        r#"
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        "#,
    )?;
    Ok(connection)
}

fn timestamp_millis_to_utc(value: i64) -> DateTime<Utc> {
    Utc.timestamp_millis_opt(value)
        .single()
        .unwrap_or_else(Utc::now)
}

/// Shared session store type
pub type SharedSessionStore = Arc<SessionStore>;
