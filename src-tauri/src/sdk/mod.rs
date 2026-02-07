//! VoiDesk AI SDK
//!
//! A modular SDK for AI interactions with OpenAI-compatible providers.
//!
//! ## Module Structure
//! - `core`: Provider-agnostic types and events
//! - `transport`: HTTP transport layer
//! - `stream`: SSE stream parsing
//! - `provider`: Provider abstraction and implementations
//! - `tools`: Tool execution framework
//! - `agent`: Orchestration of provider + tools + session
//! - `session`: In-memory session store

// New modular structure
pub mod core;
pub mod provider;
pub mod stream;
pub mod tools;
pub mod transport;

// Core modules
pub mod agent;
pub mod session;

// Compatibility shim for old client (wraps provider)
pub mod client;

// Re-exports for public API
pub use agent::{Agent, AgentEvent, AgentResult};
pub use client::AIClient;
pub use session::{Session, SessionStore};

// Core type re-exports
pub use core::events::StreamEvent;
pub use core::types::{
    ChatRequest, ChatResponse, Choice, ImageUrl, Message, MessageContent, MessagePart,
    ResponseMessageDelta, ResponseStreamError, ResponseStreamResult, Tool, ToolCall,
    ToolCallFunction, ToolChoice, ToolFunction, ToolSchemaFormat, Usage,
};

// Provider re-exports
pub use provider::{ModelCapabilities, ModelInfo, OpenAICompatibleProvider, Provider, ProviderRegistry};

// Tools re-exports
pub use tools::{AgentTool, AgentToolOutput, ToolRegistry};
