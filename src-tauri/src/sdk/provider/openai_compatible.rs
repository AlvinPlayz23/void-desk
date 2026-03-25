use anyhow::Result;
use async_trait::async_trait;
use futures::Stream;

use crate::sdk::core::{ChatRequest, ChatResponse, StreamEvent};
use crate::sdk::stream::parse_sse_stream_with_debug;
use crate::sdk::transport::HttpTransport;

use super::{
    infer_model_capabilities, infer_model_context_window, ModelInfo, OpenAICompatibleConfig,
    Provider,
};

/// OpenAI-compatible API provider
#[derive(Clone)]
pub struct OpenAICompatibleProvider {
    transport: HttpTransport,
    config: OpenAICompatibleConfig,
}

impl OpenAICompatibleProvider {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Result<Self> {
        Self::from_config(OpenAICompatibleConfig::new(api_key, base_url, model))
    }

    pub fn from_config(config: OpenAICompatibleConfig) -> Result<Self> {
        Ok(Self {
            transport: HttpTransport::new_with_config_and_headers(
                config.api_key(),
                config.base_url(),
                config.transport().clone(),
                config.default_headers().clone(),
            )?,
            config,
        })
    }

    pub fn base_url(&self) -> &str {
        self.transport.base_url()
    }
}

#[async_trait]
impl Provider for OpenAICompatibleProvider {
    fn id(&self) -> &'static str {
        "openai_compatible"
    }

    fn model(&self) -> &str {
        self.config.model()
    }

    fn model_info(&self) -> ModelInfo {
        self.config.model_info_with_defaults(
            self.id(),
            infer_model_context_window(self.config.model()),
            infer_model_capabilities(self.config.model()),
        )
    }

    async fn complete(&self, mut request: ChatRequest) -> Result<ChatResponse> {
        request.model = self.config.model().to_string();
        request.stream = false;

        let body = serde_json::to_string(&request)?;
        tracing::info!(
            "Provider complete: sending request to {} (body_len={} bytes)",
            self.base_url(),
            body.len()
        );
        let start = std::time::Instant::now();

        match self.transport.post_text("chat/completions", &body).await {
            Ok(response_text) => {
                tracing::info!(
                    "Provider complete: received response in {:?} (response_len={} bytes)",
                    start.elapsed(),
                    response_text.len()
                );
                let response: ChatResponse = serde_json::from_str(&response_text)?;
                Ok(response)
            }
            Err(e) => {
                tracing::error!(
                    "Provider complete: request failed after {:?}: {}",
                    start.elapsed(),
                    e
                );
                Err(e)
            }
        }
    }

    async fn stream(
        &self,
        mut request: ChatRequest,
        debug_raw: bool,
    ) -> Result<Box<dyn Stream<Item = Result<StreamEvent>> + Send + Unpin>> {
        request.model = self.config.model().to_string();
        request.stream = true;

        let body = serde_json::to_string(&request)?;
        let byte_stream = self
            .transport
            .post_stream("chat/completions", &body)
            .await?;

        Ok(Box::new(parse_sse_stream_with_debug(
            byte_stream,
            debug_raw,
        )))
    }
}
