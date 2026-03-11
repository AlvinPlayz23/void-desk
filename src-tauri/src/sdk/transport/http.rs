use anyhow::{anyhow, Error, Result};
use bytes::Bytes;
use futures::Stream;
use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION, CONTENT_TYPE};
use reqwest::{Client, StatusCode};
use tokio::time::{sleep, Duration};

use crate::sdk::core::SdkError;

#[derive(Debug, Clone)]
pub struct TransportConfig {
    pub timeout_ms: u64,
    pub max_retries: u32,
    pub backoff_base_ms: u64,
    pub backoff_max_ms: u64,
}

impl Default for TransportConfig {
    fn default() -> Self {
        Self {
            timeout_ms: 300_000,
            max_retries: 2,
            backoff_base_ms: 250,
            backoff_max_ms: 2_500,
        }
    }
}

/// HTTP transport for API calls
#[derive(Clone)]
pub struct HttpTransport {
    client: Client,
    base_url: String,
    api_key: String,
    config: TransportConfig,
}

impl HttpTransport {
    pub fn new(api_key: &str, base_url: &str) -> Result<Self> {
        Self::new_with_config(api_key, base_url, TransportConfig::default())
    }

    pub fn new_with_config(api_key: &str, base_url: &str, config: TransportConfig) -> Result<Self> {
        if api_key.trim().is_empty() {
            return Err(Error::new(SdkError::validation("API key is required")));
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
            config,
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
        self.retry_request(
            || async {
                let response = self
                    .client
                    .post(&url)
                    .headers(self.default_headers()?)
                    .body(body.to_string())
                    .timeout(Duration::from_millis(self.config.timeout_ms))
                    .send()
                    .await
                    .map_err(map_reqwest_error)?;

                parse_non_stream_response(response).await
            },
            "post_text",
        )
        .await
    }

    /// Send a POST request and return a byte stream for SSE
    pub async fn post_stream(
        &self,
        endpoint: &str,
        body: &str,
    ) -> Result<impl Stream<Item = reqwest::Result<Bytes>>> {
        let url = format!("{}/{}", self.base_url, endpoint);
        self.retry_request(
            || async {
                let response = self
                    .client
                    .post(&url)
                    .headers(self.default_headers()?)
                    .header("accept", "text/event-stream")
                    .body(body.to_string())
                    .timeout(Duration::from_millis(self.config.timeout_ms))
                    .send()
                    .await
                    .map_err(map_reqwest_error)?;

                if !response.status().is_success() {
                    return Err(Error::new(
                        SdkError::from_status(
                            response.status(),
                            format!(
                                "API error ({}): {}",
                                response.status(),
                                response.text().await.unwrap_or_default()
                            ),
                        )
                        .with_code("http_error"),
                    ));
                }

                Ok(response.bytes_stream())
            },
            "post_stream",
        )
        .await
    }

    async fn retry_request<T, F, Fut>(&self, mut op: F, _name: &str) -> Result<T>
    where
        F: FnMut() -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut attempt = 0_u32;
        let max_attempts = self.config.max_retries + 1;
        let mut last_err: Option<Error> = None;

        while attempt < max_attempts {
            match op().await {
                Ok(value) => return Ok(value),
                Err(err) => {
                    let retryable = error_retryable(&err);
                    last_err = Some(err);
                    attempt += 1;

                    if !retryable || attempt >= max_attempts {
                        break;
                    }

                    let backoff_ms = std::cmp::min(
                        self.config
                            .backoff_base_ms
                            .saturating_mul(2_u64.saturating_pow(attempt)),
                        self.config.backoff_max_ms,
                    );
                    sleep(Duration::from_millis(backoff_ms)).await;
                }
            }
        }

        Err(last_err.unwrap_or_else(|| anyhow!("request failed without error details")))
    }
}

fn error_retryable(err: &Error) -> bool {
    if let Some(sdk_err) = err.downcast_ref::<SdkError>() {
        return sdk_err.retryable;
    }
    false
}

fn map_reqwest_error(err: reqwest::Error) -> Error {
    if err.is_timeout() {
        return Error::new(SdkError::timeout(format!("Request timed out: {}", err)));
    }
    if err.is_connect() || err.is_request() {
        return Error::new(
            SdkError::provider(format!("Network request failed: {}", err)).with_retryable(true),
        );
    }
    Error::new(SdkError::provider(format!("Request failed: {}", err)))
}

async fn parse_non_stream_response(response: reqwest::Response) -> Result<String> {
    let status: StatusCode = response.status();
    if !status.is_success() {
        let error_text = response.text().await.unwrap_or_default();
        return Err(Error::new(
            SdkError::from_status(status, format!("API error ({}): {}", status, error_text))
                .with_code("http_error"),
        ));
    }

    response.text().await.map_err(map_reqwest_error)
}
