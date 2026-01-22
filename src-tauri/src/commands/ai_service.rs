//! AI Service module using adk-rust
//!
//! This module provides the AI agent infrastructure for VoiDesk,
//! including session management, agent creation, and streaming responses.

use adk_agent::LlmAgentBuilder;
use adk_core::Content;
use adk_model::openai::OpenAIClient;
use adk_runner::{Runner, RunnerConfig};
use adk_session::{CreateRequest, InMemorySessionService, SessionService};
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
        active_path: Option<&str>,
    ) -> Result<adk_agent::LlmAgent, String> {
        // Build the OpenAI config
        // For OpenRouter/custom providers, we need to set a custom base URL
        // adk-rust expects base URL ending with /v1
        let api_base = if base_url.ends_with("/v1") || base_url.ends_with("/v1/") {
            base_url.trim_end_matches('/').to_string()
        } else {
            format!("{}/v1", base_url.trim_end_matches('/'))
        };

        // Create OpenAI-compatible model using the 3-argument compatible method
        // arguments: api_key, api_base, model_id
        let model = OpenAIClient::compatible(api_key, &api_base, model_id)
            .map_err(|e| format!("Failed to create model: {}", e))?;

        // Get all available tools, restricted to active_path
        let tools = ai_tools::get_all_tools(active_path);

        // Build the agent with tools
        let mut builder = LlmAgentBuilder::new("voidesk_assistant")
            .description("VoiDesk AI IDE Assistant")
            .instruction(
                r#"You are VoiDesk, an intelligent AI coding assistant integrated into a professional IDE.

## YOUR CAPABILITIES

You have direct access to the user's project through these tools:
- **read_file(path)**: Read any file in the project to understand code, configs, or data
- **write_file(path, content)**: Create new files or overwrite existing ones
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
3. Use `write_file` to make changes
4. Use `run_command` to test if appropriate

**When asked to "fix a bug":**
1. Use `read_file` to see the problematic code
2. Analyze and explain the issue
3. Use `write_file` to apply the fix
4. Suggest testing with `run_command`

**When asked "what does X do":**
1. Use `read_file` to examine the code
2. Provide a detailed explanation based on actual content

## IMPORTANT RULES

- Paths should be relative to the project root (e.g., "src/main.rs", not "/absolute/path")
- Always read before writing to avoid breaking existing code
- After file operations, confirm what you did ("Created src/new_file.rs with...")
- If you're unsure about project structure, use `list_directory` first
- For multi-file changes, tackle one file at a time and explain each step

## RESPONSE STYLE

- Be direct and technical
- Use markdown code blocks for code snippets
- Highlight important operations in your explanations
- If you use a tool, mention it explicitly ("I'll read the file to check...")

Remember: You're not just a chatbot - you're a hands-on coding partner with actual file system access. Use it!"#,
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
