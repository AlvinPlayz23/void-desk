use anyhow::Result;
use reqwest::header::{HeaderMap, HeaderValue};

use crate::sdk::provider::{ModelCapabilities, ModelInfo};
use crate::sdk::transport::TransportConfig;

#[derive(Clone, Debug)]
pub struct OpenAICompatibleConfig {
    api_key: String,
    base_url: String,
    model: String,
    transport: TransportConfig,
    default_headers: HeaderMap,
    context_window: Option<usize>,
    max_output_tokens: Option<usize>,
    capabilities: Option<ModelCapabilities>,
}

impl OpenAICompatibleConfig {
    pub fn new(api_key: impl Into<String>, base_url: impl Into<String>, model: impl Into<String>) -> Self {
        Self {
            api_key: api_key.into(),
            base_url: base_url.into(),
            model: model.into(),
            transport: TransportConfig::default(),
            default_headers: HeaderMap::new(),
            context_window: None,
            max_output_tokens: None,
            capabilities: None,
        }
    }

    pub fn api_key(&self) -> &str {
        &self.api_key
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    pub fn model(&self) -> &str {
        &self.model
    }

    pub fn transport(&self) -> &TransportConfig {
        &self.transport
    }

    pub fn default_headers(&self) -> &HeaderMap {
        &self.default_headers
    }

    pub fn context_window(&self) -> Option<usize> {
        self.context_window
    }

    pub fn max_output_tokens(&self) -> Option<usize> {
        self.max_output_tokens
    }

    pub fn capabilities(&self) -> Option<&ModelCapabilities> {
        self.capabilities.as_ref()
    }

    pub fn with_transport_config(mut self, transport: TransportConfig) -> Self {
        self.transport = transport;
        self
    }

    pub fn with_context_window(mut self, context_window: usize) -> Self {
        self.context_window = Some(context_window);
        self
    }

    pub fn with_max_output_tokens(mut self, max_output_tokens: usize) -> Self {
        self.max_output_tokens = Some(max_output_tokens);
        self
    }

    pub fn with_capabilities(mut self, capabilities: ModelCapabilities) -> Self {
        self.capabilities = Some(capabilities);
        self
    }

    pub fn with_header<K, V>(mut self, key: K, value: V) -> Result<Self>
    where
        K: reqwest::header::IntoHeaderName,
        V: TryInto<HeaderValue>,
        V::Error: Into<reqwest::header::InvalidHeaderValue>,
    {
        let header_value = value.try_into().map_err(|error| {
            anyhow::anyhow!("invalid header value: {}", error.into())
        })?;
        self.default_headers.insert(key, header_value);
        Ok(self)
    }

    pub fn model_info_with_defaults(
        &self,
        provider_id: &'static str,
        inferred_context_window: Option<usize>,
        inferred_capabilities: ModelCapabilities,
    ) -> ModelInfo {
        ModelInfo {
            id: self.model.clone(),
            display_name: self.model.clone(),
            provider_id: provider_id.to_string(),
            context_window: self.context_window.or(inferred_context_window),
            max_output_tokens: self.max_output_tokens,
            capabilities: self
                .capabilities
                .clone()
                .unwrap_or(inferred_capabilities),
        }
    }
}
