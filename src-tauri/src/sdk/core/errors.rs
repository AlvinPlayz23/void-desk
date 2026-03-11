use std::fmt::{Display, Formatter};

use reqwest::StatusCode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ErrorCategory {
    Validation,
    Provider,
    Stream,
    Tool,
    Permission,
    Timeout,
    Internal,
}

#[derive(Debug, Clone)]
pub struct SdkError {
    pub category: ErrorCategory,
    pub message: String,
    pub retryable: bool,
    pub code: Option<String>,
    pub status: Option<u16>,
}

impl SdkError {
    pub fn new(category: ErrorCategory, message: impl Into<String>) -> Self {
        Self {
            category,
            message: message.into(),
            retryable: false,
            code: None,
            status: None,
        }
    }

    pub fn with_retryable(mut self, retryable: bool) -> Self {
        self.retryable = retryable;
        self
    }

    pub fn with_code(mut self, code: impl Into<String>) -> Self {
        self.code = Some(code.into());
        self
    }

    pub fn with_status(mut self, status: u16) -> Self {
        self.status = Some(status);
        self
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Validation, message)
    }

    pub fn provider(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Provider, message)
    }

    pub fn stream(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Stream, message)
    }

    pub fn tool(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Tool, message)
    }

    pub fn permission(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Permission, message)
    }

    pub fn timeout(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Timeout, message).with_retryable(true)
    }

    pub fn internal(message: impl Into<String>) -> Self {
        Self::new(ErrorCategory::Internal, message)
    }

    pub fn from_status(status: StatusCode, message: impl Into<String>) -> Self {
        let retryable = is_retryable_status(status);
        Self::provider(message)
            .with_status(status.as_u16())
            .with_retryable(retryable)
    }
}

impl Display for SdkError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        write!(f, "{:?}: {}", self.category, self.message)
    }
}

impl std::error::Error for SdkError {}

pub fn is_retryable_status(status: StatusCode) -> bool {
    matches!(
        status,
        StatusCode::TOO_MANY_REQUESTS
            | StatusCode::INTERNAL_SERVER_ERROR
            | StatusCode::BAD_GATEWAY
            | StatusCode::SERVICE_UNAVAILABLE
            | StatusCode::GATEWAY_TIMEOUT
    )
}
