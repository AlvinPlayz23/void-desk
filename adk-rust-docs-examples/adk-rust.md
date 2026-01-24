# adk-rust: Agent Development Kit for Rust

Comprehensive guide for the `adk-rust` SDK, its architecture, and integration into the VoiDesk IDE.

---

## 🏗 Architecture Overview

The `adk-rust` framework is designed as a modular, provider-agnostic system for building agentic AI applications. It consists of several specialized crates:

### 1. `adk-core`
The foundation of the SDK. Defines the core traits and types used across all components.
- **Traits**: `Llm`, `ToolContext`
- **Types**: `Content`, `Part` (Text, InlineData, FunctionCall, FunctionResponse), `AdkError`, `UsageMetadata`

### 2. `adk-model`
Contains LLM provider implementations. Each implementation satisfies the `Llm` trait.
- **Providers**: `Gemini` (Default), `OpenAI`, `Anthropic`, `DeepSeek`, `Groq`
- **Compatibility**: Supports OpenAI-compatible endpoints (OpenRouter, Ollama, vLLM) via `OpenAIClient::compatible()`.

### 3. `adk-agent`
High-level agent abstractions for reasoning and task execution.
- **`LlmAgent`**: A reasoning agent that uses a model and tools to achieve goals.
- **`LlmAgentBuilder`**: Fluent interface for configuring instruction, description, model, and tools.

### 4. `adk-tool`
A tool system for extending agent capabilities.
- **`FunctionTool`**: Wraps any async function into a tool the AI can call.
- **`JsonSchema`**: Uses `schemars` for automatic JSON schema generation for tool arguments.

### 5. `adk-runner`
The execution runtime that orchestrates the interaction between agents, models, and sessions.
- **`Runner`**: Handles the message loop, streaming, and tool execution.

### 6. `adk-session`
Manages conversation history and state.
- **`InMemorySessionService`**: Default implementation for non-persistent sessions.
- **`SessionService` trait**: For implementing custom persistent storage.

---

## 🚀 Key Integration: OpenRouter & Custom Models

The primary reason for migrating to `adk-rust` is its robust support for custom base URLs and string-based model IDs, which `aisdk` lacks.

### Configuring OpenRouter
```rust
use adk_model::openai::{OpenAIClient, OpenAICompatibleProvider};

let model = OpenAIClient::compatible(OpenAICompatibleProvider {
    api_key: "your-openrouter-key".to_string(),
    api_base: "https://openrouter.ai/api".to_string(),  // Standard OpenAI base
    model: "mistralai/devstral-2512:free".to_string(),  // DYNAMIC model ID!
})?;
```

---

## 🛠 Tool Implementation (VoiDesk Example)

Unlike macros, `adk-rust` uses a explicit but flexible tool system.

### Defining a Tool
```rust
use adk_tool::FunctionTool;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct ReadFileArgs {
    /// Absolute path to the file
    path: String,
}

async fn read_file_fn(ctx: Arc<dyn ToolContext>, args: Value) -> Result<Value, adk_core::AdkError> {
    let args: ReadFileArgs = serde_json::from_value(args)
        .map_err(|e| adk_core::AdkError::Tool(format!("Invalid args: {}", e)))?;
    
    let content = std::fs::read_to_string(&args.path)
        .map_err(|e| adk_core::AdkError::Tool(e.to_string()))?;

    Ok(serde_json::json!({ "content": content }))
}

let read_file_tool = FunctionTool::new(
    "read_file",
    "Read the content of a file from the local system",
    read_file_fn
).with_parameters_schema::<ReadFileArgs>();
```

---

## 📡 Streaming & Event Loop

`adk-rust` runners provide a stream of events that includes text chunks, tool calls, and completion info.

### Streaming in `ai_commands.rs`
```rust
let mut stream = runner.run(user_id, session_id, user_content).await?;

while let Some(event) = stream.next().await {
    match event {
        Ok(e) => {
            // Check for text content
            if let Some(content) = e.llm_response.content {
                for part in content.parts {
                    if let adk_core::Part::Text { text } = part {
                        // Send text to frontend via Channel
                        on_event.send(AIResponseChunk::Text(text));
                    }
                    if let adk_core::Part::FunctionCall { name, args, .. } = part {
                         // Tool call detected
                         on_event.send(AIResponseChunk::ToolCall(name, args));
                    }
                }
            }
        }
        Err(e) => {
            on_event.send(AIResponseChunk::Error(e.to_string()));
        }
    }
}
```

---

## 📦 Dependencies (Cargo.toml)

```toml
[dependencies]
adk-agent = "0.2"
adk-core = "0.2"
adk-model = { version = "0.2", features = ["openai"] }
adk-tool = "0.2"
adk-runner = "0.2"
adk-session = "0.2"
schemars = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
futures = "0.3"
anyhow = "1"
```

---

## 🔄 Migration from `aisdk`

| Component | `aisdk` (Old) | `adk-rust` (New) |
|-----------|---------------|-----------------|
| **Model Creation** | `OpenAI::<Gpt4o>::builder()` | `OpenAIClient::new(OpenAIConfig::new(key, model))` |
| **Model ID** | Hardcoded in type | Dynamic string |
| **Base URL** | Limited support | `OpenAIClient::compatible()` |
| **Tool Definition** | `#[tool]` macro | `FunctionTool` with `JsonSchema` |
| **Request Orchestration** | `LanguageModelRequest` | `Runner` + `SessionService` |
| **Tool Response Loop** | Managed manually | Automatic recursion in `Runner` |

---

## 📚 References

- **Internal Docs**: `adk-rust-docs-examples/docs/`
- **Internal Examples**: `adk-rust-docs-examples/examples/`
- **GitHub**: `https://github.com/adk-rust/adk-rust` (Community repository)
- **Crates.io**: `https://crates.io/crates/adk-rust`

---

## ✅ Implementation Status in VoiDesk

- [x] Architecture finalized
- [x] Dependency migration plan ready
- [x] OpenRouter configuration strategy identified
- [x] Tool schema pattern (schemars) confirmed
- [ ] Updating `ai_commands.rs` to use `adk_runner`
- [ ] Refactoring `ai_tools.rs` to use `FunctionTool`
