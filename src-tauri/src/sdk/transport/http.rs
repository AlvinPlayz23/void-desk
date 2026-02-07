use anyhow::{anyhow, Result};
use bytes::Bytes;
use futures::Stream;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::Client;

/// HTTP transport for API calls
#[derive(Clone)]
pub struct HttpTransport {
    client: Client,
    base_url: String,
    api_key: String,
}

impl HttpTransport {
    pub fn new(api_key: &str, base_url: &str) -> Result<Self> {
        if api_key.trim().is_empty() {
            return Err(anyhow!("API key is required"));
        }

        let normalized = base_url.trim().trim_end_matches('/');
        let base_url = if normalized.ends_with("/v1") {
            normalized.to_string()
        } else {
            format!("{}/v1", normalized)
        };

        Ok(Self {
            client: Client::new(),
            base_url,
            api_key: api_key.to_string(),
        })
    }

    pub fn base_url(&self) -> &str {
        &self.base_url
    }

    fn default_headers(&self) -> Result<HeaderMap> {
        let mut headers = HeaderMap::new();
        headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
        headers.insert(
            AUTHORIZATION,
            HeaderValue::from_str(&format!("Bearer {}", self.api_key))?,
        );
        Ok(headers)
    }

    /// Send a POST request and return raw text response
    pub async fn post_text(&self, endpoint: &str, body: &str) -> Result<String> {
        let url = format!("{}/{}", self.base_url, endpoint);
        let response = self
            .client
            .post(&url)
            .headers(self.default_headers()?)
            .body(body.to_string())
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow!("API error ({}): {}", status, error_text));
        }

        Ok(response.text().await?)
    }

    /// Send a POST request and return a byte stream for SSE
    pub async fn post_stream(
        &self,
        endpoint: &str,
        body: &str,
    ) -> Result<impl Stream<Item = reqwest::Result<Bytes>>> {
        let url = format!("{}/{}", self.base_url, endpoint);
        let response = self
            .client
            .post(&url)
            .headers(self.default_headers()?)
            .header("accept", "text/event-stream")
            .body(body.to_string())
            .send()
            .await?;

        if !response.status().is_success() {
            let status = response.status();
            let error_text = response.text().await.unwrap_or_default();
            return Err(anyhow!("API error ({}): {}", status, error_text));
        }

        Ok(response.bytes_stream())
    }
}
