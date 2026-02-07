pub mod openai_compatible;
pub mod registry;

pub use openai_compatible::OpenAICompatibleProvider;
pub use registry::ProviderRegistry;

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
    let supports_reasoning = id.contains("o1")
        || id.contains("reason")
        || id.contains("r1")
        || id.contains("deepseek");
    let supports_vision = id.contains("vision")
        || id.contains("gpt-4o")
        || id.contains("gpt-4.1")
        || id.contains("gpt-4-turbo")
        || id.contains("claude-3")
        || id.contains("gemini");

    ModelCapabilities {
        supports_streaming: true,
        supports_tools: true,
        supports_vision,
        supports_reasoning,
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
