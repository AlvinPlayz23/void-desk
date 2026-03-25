pub mod codex_subscription;
pub mod config;
pub mod openai_compatible;

pub use codex_subscription::CodexSubscriptionProvider;
pub use config::OpenAICompatibleConfig;
pub use openai_compatible::OpenAICompatibleProvider;

use anyhow::Result;
use async_trait::async_trait;
use futures::Stream;

use crate::sdk::core::{ChatRequest, ChatResponse, StreamEvent};

#[derive(Debug, Clone)]
pub struct ModelCapabilities {
    pub supports_streaming: bool,
    pub supports_tools: bool,
    pub supports_vision: bool,
    pub supports_reasoning: bool,
}

#[derive(Debug, Clone)]
pub struct ModelInfo {
    pub id: String,
    pub display_name: String,
    pub provider_id: String,
    pub context_window: Option<usize>,
    pub max_output_tokens: Option<usize>,
    pub capabilities: ModelCapabilities,
}

pub fn infer_model_capabilities(model_id: &str) -> ModelCapabilities {
    let id = model_id.to_lowercase();
    let supports_reasoning = id.starts_with("o1")
        || id.starts_with("o3")
        || id.contains("reasoner")
        || id.contains("reasoning");
    let supports_vision = id.starts_with("gpt-4o")
        || id.starts_with("gpt-4.1")
        || id.starts_with("gpt-4-turbo")
        || id.contains("vision");

    ModelCapabilities {
        supports_streaming: true,
        supports_tools: true,
        supports_vision,
        supports_reasoning,
    }
}

pub fn infer_model_context_window(model_id: &str) -> Option<usize> {
    let id = model_id.to_lowercase();

    if id.starts_with("gpt-4.1") || id.starts_with("gpt-4o") || id.starts_with("gpt-4-turbo") {
        return Some(128_000);
    }

    if id.starts_with("gpt-3.5") {
        return Some(16_000);
    }

    None
}

#[cfg(test)]
mod tests {
    use super::infer_model_context_window;

    #[test]
    fn infers_known_openai_context_windows() {
        assert_eq!(infer_model_context_window("gpt-4o"), Some(128_000));
        assert_eq!(infer_model_context_window("gpt-3.5-turbo"), Some(16_000));
    }

    #[test]
    fn returns_none_for_unknown_models() {
        assert_eq!(infer_model_context_window("custom-local-model"), None);
    }
}

/// Provider trait for LLM API adapters
#[async_trait]
pub trait Provider: Send + Sync {
    /// Provider identifier
    fn id(&self) -> &'static str;

    /// Model identifier
    fn model(&self) -> &str;

    /// Model capabilities and metadata
    fn model_info(&self) -> ModelInfo;

    /// Send a non-streaming completion request
    async fn complete(&self, request: ChatRequest) -> Result<ChatResponse>;

    /// Send a streaming completion request
    async fn stream(
        &self,
        request: ChatRequest,
        debug_raw: bool,
    ) -> Result<Box<dyn Stream<Item = Result<StreamEvent>> + Send + Unpin>>;
}
