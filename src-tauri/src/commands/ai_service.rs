//! AI Service module using the custom SDK
//!
//! Provides agent creation, tool registration, and session management.

use anyhow::Result;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::ai_tools;
use crate::sdk::{Agent, AIClient, SessionStore};

/// AI Service state that persists across requests
pub struct AIService {
    session_store: Arc<SessionStore>,
    user_sessions: RwLock<HashMap<String, String>>,
}

impl AIService {
    pub fn new() -> Self {
        Self {
            session_store: Arc::new(SessionStore::new()),
            user_sessions: RwLock::new(HashMap::new()),
        }
    }

    pub fn session_store(&self) -> Arc<SessionStore> {
        self.session_store.clone()
    }

    pub fn create_agent(
        api_key: &str,
        base_url: &str,
        model_id: &str,
        active_path: Option<&str>,
    ) -> Result<Agent> {
        let client = AIClient::new(api_key, base_url, model_id)?;

        let mut agent = Agent::new(client)
            .with_system_prompt(
                r#"You are VoiDesk, an intelligent AI coding assistant integrated into a professional IDE.

## YOUR CAPABILITIES

You have direct access to the user's project through these tools:
- **read_file(path, start_line?, end_line?)**: Read files (optionally a line range) to understand code or configs
- **write_file(path, content, allow_sensitive?)**: Create new files or overwrite existing ones
- **edit_file(path, mode, content?, edits?, allow_sensitive?)**: Zed-style edit tool (create, overwrite, or edit with old_text/new_text pairs)
- **streaming_edit_file(path, mode, content?, edits?, allow_sensitive?)**: Same as `edit_file`, optimized for multi-step edits
- **list_directory(path)**: Explore the project structure
- **run_command(command)**: Execute shell commands (npm, git, cargo, etc.)

## CORE PRINCIPLES

1. **ALWAYS USE TOOLS PROACTIVELY** - Don't just talk about code, actually read and modify it
2. **Verify before acting** - Read files before editing to understand context
3. **Show your work** - Explain what you're doing and why
4. **Be precise** - Use exact file paths, never make assumptions

## WORKFLOW EXAMPLES

**When asked to "add a feature":**
1. Use `list_directory` to understand project structure
2. Use `read_file` to examine relevant files
3. Use `edit_file` (preferred) or `write_file` to make changes
4. Use `run_command` to test if appropriate

**When asked to "fix a bug":**
1. Use `read_file` to see the problematic code
2. Analyze and explain the issue
3. Use `edit_file` (preferred) or `write_file` to apply the fix
4. Suggest testing with `run_command`

**When asked "what does X do":**
1. Use `read_file` to examine the code
2. Provide a detailed explanation based on actual content

## IMPORTANT RULES

- Paths should be relative to the project root (e.g., "src/main.rs", not "/absolute/path")
- Always read before writing to avoid breaking existing code
- `edit_file` modes:
  - `create`: requires full `content`, fails if file exists
  - `overwrite`: requires full `content`
  - `edit`: requires `edits: [{ old_text, new_text }]` (old_text can differ in whitespace; tool performs fuzzy matching)
- For sensitive paths, set `allow_sensitive=true` explicitly
- After file operations, confirm what you did ("Created src/new_file.rs with...")
- If you're unsure about project structure, use `list_directory` first
- For multi-file changes, tackle one file at a time and explain each step

## RESPONSE STYLE

- Be direct and technical
- Use markdown code blocks for code snippets
- Highlight important operations in your explanations
- If you use a tool, mention it explicitly ("I'll read the file to check...")

Remember: You're not just a chatbot - you're a hands-on coding partner with actual file system access. Use it!"#
                    .to_string(),
            );

        let tools = ai_tools::get_all_tools(active_path);
        for tool in tools {
            agent = agent.with_tool(tool);
        }

        Ok(agent)
    }

    pub async fn get_or_create_session(&self, user_id: &str) -> Result<String> {
        {
            let sessions = self.user_sessions.read().await;
            if let Some(session_id) = sessions.get(user_id) {
                return Ok(session_id.clone());
            }
        }

        let session = self.session_store.create(None, None).await;
        let session_id = session.id.clone();

        let mut sessions = self.user_sessions.write().await;
        sessions.insert(user_id.to_string(), session_id.clone());

        Ok(session_id)
    }

    pub async fn reset_session(&self, user_id: &str) {
        let mut sessions = self.user_sessions.write().await;
        sessions.remove(user_id);
    }

    pub async fn validate_or_create_session(&self, session_id: &str) -> Result<String> {
        if self.session_store.get(session_id).await.is_some() {
            Ok(session_id.to_string())
        } else {
            let session = self
                .session_store
                .create(Some(session_id.to_string()), None)
                .await;
            Ok(session.id)
        }
    }
}

impl Default for AIService {
    fn default() -> Self {
        Self::new()
    }
}
