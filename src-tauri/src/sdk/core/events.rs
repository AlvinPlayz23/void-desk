//! Stream events for AI responses

/// Events emitted during streaming responses
#[derive(Debug, Clone)]
pub enum StreamEvent {
    /// Text content delta
    TextDelta(String),
    /// Tool call request from the model
    ToolCall {
        id: String,
        name: String,
        arguments: String,
    },
    /// Raw SSE data (debug only)
    Raw(String),
    /// Stream completed
    Done,
}
