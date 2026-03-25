//! Stream events for AI responses

use serde_json::Value;

use crate::sdk::core::Message;
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

#[derive(Debug, Clone)]
pub struct ToolStartEvent {
    pub name: String,
    pub input: Value,
}

#[derive(Debug, Clone)]
pub struct ToolResultEvent {
    pub name: String,
    pub result: String,
    pub success: bool,
}

#[derive(Debug, Clone)]
pub struct DebugEvent {
    pub kind: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct CancelledEvent {
    pub reason: String,
    pub messages: Vec<Message>,
}

#[derive(Debug, Clone)]
pub struct DoneEvent {
    pub final_text: String,
    pub messages: Vec<Message>,
}

/// Events emitted by the agent during execution.
#[derive(Debug, Clone)]
pub enum AgentEvent {
    TextDelta(String),
    ReasoningDelta(String),
    UsageDelta(Usage),
    ToolStart(ToolStartEvent),
    ToolResult(ToolResultEvent),
    Debug(DebugEvent),
    Cancelled(CancelledEvent),
    Done(DoneEvent),
}
