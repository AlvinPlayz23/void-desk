//! Stream events for AI responses

use crate::sdk::core::Usage;

/// Events emitted during streaming responses
#[derive(Debug, Clone)]
pub enum StreamEvent {
    /// Text content delta
    TextDelta(String),
    /// Reasoning content delta
    ReasoningDelta(String),
    /// Tool call request from the model
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    /// Usage update
    UsageDelta(Usage),
    /// Raw SSE data (debug only)
    Raw(String),
    /// Stream completed
    Done,
}
