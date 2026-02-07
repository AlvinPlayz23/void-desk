//! AIClient - Compatibility wrapper around OpenAICompatibleProvider
//!
//! This module provides backward compatibility for code using AIClient.
//! Internally it delegates to the new provider abstraction.

use anyhow::Result;
use futures::Stream;

use crate::sdk::core::{ChatRequest, ChatResponse, StreamEvent};
use crate::sdk::provider::{ModelInfo, OpenAICompatibleProvider, Provider};

/// AI Client for OpenAI-compatible APIs
///
/// This is a convenience wrapper around `OpenAICompatibleProvider`.
#[derive(Clone)]
pub struct AIClient {
    provider: OpenAICompatibleProvider,
}

impl AIClient {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Result<Self> {
        Ok(Self {
            provider: OpenAICompatibleProvider::new(api_key, base_url, model)?,
        })
    }

    pub fn model(&self) -> &str {
        self.provider.model()
    }

    pub fn model_info(&self) -> ModelInfo {
        self.provider.model_info()
    }

    pub fn base_url(&self) -> &str {
        self.provider.base_url()
    }

    pub fn with_model(mut self, model: &str) -> Self {
        self.provider = OpenAICompatibleProvider::new(
            "", // This won't work - keeping for API compat
            self.provider.base_url(),
            model,
        )
        .unwrap_or(self.provider);
        self
    }

    pub async fn complete(&self, request: ChatRequest) -> Result<ChatResponse> {
        self.provider.complete(request).await
    }

    pub async fn stream(
        &self,
        request: ChatRequest,
    ) -> Result<impl Stream<Item = Result<StreamEvent>>> {
        self.stream_with_debug(request, false).await
    }

    pub async fn stream_with_debug(
        &self,
        request: ChatRequest,
        debug_raw: bool,
    ) -> Result<impl Stream<Item = Result<StreamEvent>>> {
        self.provider.stream(request, debug_raw).await
    }
}
