//! Session store for conversation history

use chrono::{DateTime, Utc};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;
use uuid::Uuid;

use crate::sdk::core::Message;

/// A conversation session
#[derive(Debug, Clone)]
pub struct Session {
    pub id: String,
    pub name: Option<String>,
    pub messages: Vec<Message>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

/// In-memory session store
#[derive(Default)]
pub struct SessionStore {
    sessions: RwLock<HashMap<String, Session>>,
}

impl SessionStore {
    pub fn new() -> Self {
        Self {
            sessions: RwLock::new(HashMap::new()),
        }
    }

    pub async fn create(&self, id: Option<String>, name: Option<String>) -> Session {
        let id = id.unwrap_or_else(|| Uuid::new_v4().to_string());
        let now = Utc::now();
        let session = Session {
            id: id.clone(),
            name,
            messages: Vec::new(),
            created_at: now,
            updated_at: now,
        };

        let mut sessions = self.sessions.write().await;
        sessions.insert(id.clone(), session.clone());

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
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.messages.push(message);
            session.updated_at = Utc::now();
        }
    }

    pub async fn append_many(&self, id: &str, messages: Vec<Message>) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.messages.extend(messages);
            session.updated_at = Utc::now();
        }
    }

    pub async fn replace_messages(&self, id: &str, messages: Vec<Message>) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.messages = messages;
            session.updated_at = Utc::now();
        }
    }

    pub async fn set_name(&self, id: &str, name: Option<String>) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.name = name;
            session.updated_at = Utc::now();
        }
    }

    pub async fn clear(&self, id: &str) {
        let mut sessions = self.sessions.write().await;
        if let Some(session) = sessions.get_mut(id) {
            session.messages.clear();
            session.updated_at = Utc::now();
        }
    }

    pub async fn delete(&self, id: &str) {
        let mut sessions = self.sessions.write().await;
        sessions.remove(id);
    }
}

/// Shared session store type
pub type SharedSessionStore = Arc<SessionStore>;
