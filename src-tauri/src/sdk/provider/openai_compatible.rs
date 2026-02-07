use anyhow::Result;
use async_trait::async_trait;
use futures::Stream;

use crate::sdk::core::{ChatRequest, ChatResponse, StreamEvent};
use crate::sdk::stream::parse_sse_stream_with_debug;
use crate::sdk::transport::HttpTransport;

use super::{infer_model_capabilities, ModelInfo, Provider};

/// OpenAI-compatible API provider
#[derive(Clone)]
pub struct OpenAICompatibleProvider {
    transport: HttpTransport,
    model: String,
}

impl OpenAICompatibleProvider {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Result<Self> {
        Ok(Self {
            transport: HttpTransport::new(api_key, base_url)?,
            model: model.to_string(),
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
        &self.model
    }

    fn model_info(&self) -> ModelInfo {
        ModelInfo {
            id: self.model.clone(),
            display_name: self.model.clone(),
            provider_id: self.id().to_string(),
            context_window: None,
            max_output_tokens: None,
            capabilities: infer_model_capabilities(&self.model),
        }
    }

    async fn complete(&self, mut request: ChatRequest) -> Result<ChatResponse> {
        request.model = self.model.clone();
        request.stream = false;

        let body = serde_json::to_string(&request)?;
        let response_text = self.transport.post_text("chat/completions", &body).await?;
        let response: ChatResponse = serde_json::from_str(&response_text)?;

        Ok(response)
    }

    async fn stream(
        &self,
        mut request: ChatRequest,
        debug_raw: bool,
    ) -> Result<Box<dyn Stream<Item = Result<StreamEvent>> + Send + Unpin>> {
        request.model = self.model.clone();
        request.stream = true;

        let body = serde_json::to_string(&request)?;
        let byte_stream = self.transport.post_stream("chat/completions", &body).await?;

        Ok(Box::new(parse_sse_stream_with_debug(byte_stream, debug_raw)))
    }
}
