//! AI Service module using adk-rust
//!
//! This module provides the AI agent infrastructure for VoiDesk,
//! including session management, agent creation, and streaming responses.

use adk_agent::LlmAgentBuilder;
use adk_core::Content;
use adk_model::openai::{OpenAIClient, OpenAICompatibleProvider};
use adk_runner::{Runner, RunnerConfig};
use adk_session::{CreateRequest, InMemorySessionService, SessionService};
use futures::StreamExt;
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

use super::ai_tools;

/// AI Service state that persists across requests
pub struct AIService {
    session_service: Arc<InMemorySessionService>,
    /// Cache of user sessions: user_id -> session_id
    user_sessions: RwLock<HashMap<String, String>>,
}

impl AIService {
    pub fn new() -> Self {
        Self {
            session_service: Arc::new(InMemorySessionService::new()),
            user_sessions: RwLock::new(HashMap::new()),
        }
    }

    /// Create an AI agent with the given configuration
    pub fn create_agent(
        api_key: &str,
        base_url: &str,
        model_id: &str,
    ) -> Result<adk_agent::LlmAgent, String> {
        // Build the API base URL - adk-rust expects base without /v1
        let api_base = if base_url.ends_with("/v1") {
            base_url.trim_end_matches("/v1").to_string()
        } else if base_url.ends_with("/v1/") {
            base_url.trim_end_matches("/v1/").to_string()
        } else {
            base_url.trim_end_matches('/').to_string()
        };

        // Create OpenAI-compatible model (works with OpenRouter, local servers, etc.)
        let model = OpenAIClient::compatible(OpenAICompatibleProvider {
            api_key: api_key.to_string(),
            api_base,
            model: model_id.to_string(),
        })
        .map_err(|e| format!("Failed to create model: {}", e))?;

        // Get all available tools
        let tools = ai_tools::get_all_tools();

        // Build the agent with tools
        let mut builder = LlmAgentBuilder::new("voidesk_assistant")
            .description("VoiDesk AI IDE Assistant")
            .instruction(
                r#"You are VoiDesk, a high-performance AI IDE assistant. You help developers with:
- Reading and understanding code
- Writing and modifying files
- Running shell commands for builds, tests, and git operations
- Explaining concepts and debugging issues

Be helpful, concise, and accurate. When modifying code, explain what you're changing and why.
Use the available tools when needed to interact with the file system or run commands.

Always prefer to:
1. Read files before modifying them to understand the context
2. Explain your changes before making them
3. Run tests after making changes when appropriate"#,
            )
            .model(Arc::new(model));

        // Add all tools to the agent
        for tool in tools {
            builder = builder.tool(tool);
        }

        builder.build().map_err(|e| format!("Failed to build agent: {}", e))
    }

    /// Get or create a session for a user
    pub async fn get_or_create_session(&self, user_id: &str, app_name: &str) -> Result<String, String> {
        // Check if we have a cached session
        {
            let sessions = self.user_sessions.read().await;
            if let Some(session_id) = sessions.get(user_id) {
                return Ok(session_id.clone());
            }
        }

        // Create a new session
        let session = self.session_service
            .create(CreateRequest {
                app_name: app_name.to_string(),
                user_id: user_id.to_string(),
                session_id: None,
                state: HashMap::new(),
            })
            .await
            .map_err(|e| format!("Failed to create session: {}", e))?;

        let session_id = session.id().to_string();

        // Cache the session
        {
            let mut sessions = self.user_sessions.write().await;
            sessions.insert(user_id.to_string(), session_id.clone());
        }

        Ok(session_id)
    }

    /// Create a runner for executing the agent
    pub fn create_runner(
        &self,
        agent: adk_agent::LlmAgent,
        app_name: &str,
    ) -> Result<Runner, String> {
        Runner::new(RunnerConfig {
            app_name: app_name.to_string(),
            agent: Arc::new(agent),
            session_service: self.session_service.clone(),
            artifact_service: None,
            memory_service: None,
            run_config: None,
        })
        .map_err(|e| format!("Failed to create runner: {}", e))
    }

    /// Reset a user's session (for new conversations)
    pub async fn reset_session(&self, user_id: &str) {
        let mut sessions = self.user_sessions.write().await;
        sessions.remove(user_id);
    }
}

impl Default for AIService {
    fn default() -> Self {
        Self::new()
    }
}

/// Create user content from a message string
pub fn create_user_content(message: &str) -> Content {
    Content::new("user").with_text(message)
}
