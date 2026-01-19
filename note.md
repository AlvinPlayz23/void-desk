# ADK-Rust Implementation Notes

## Key Finding: Custom Base URL Support for OpenRouter

The `adk-rust` library supports custom base URLs via `OpenAIClient::compatible()`:

```rust
use adk_model::openai::{OpenAIClient, OpenAICompatibleProvider};

// OpenRouter or any OpenAI-compatible API
let model = OpenAIClient::compatible(OpenAICompatibleProvider {
    api_key: "your-openrouter-key".to_string(),
    api_base: "https://openrouter.ai/api".to_string(),  // Base URL (without /v1)
    model: "mistralai/devstral-2512:free".to_string(),  // Custom model ID as string!
})?;
```

---

## Core Patterns

### 1. Basic OpenAI Client
```rust
use adk_model::openai::{OpenAIClient, OpenAIConfig};

let api_key = std::env::var("OPENAI_API_KEY")?;
let model = OpenAIClient::new(OpenAIConfig::new(api_key, "gpt-4o-mini"))?;
```

### 2. Agent with Model
```rust
use adk_agent::LlmAgentBuilder;
use std::sync::Arc;

let agent = LlmAgentBuilder::new("assistant")
    .model(Arc::new(model))
    .instruction("You are a helpful assistant.")
    .build()?;
```

### 3. Tool Definition (FunctionTool)
```rust
use adk_tool::FunctionTool;
use adk_core::ToolContext;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct MyToolArgs {
    /// Description of the argument
    arg_name: String,
}

async fn my_tool_fn(_ctx: Arc<dyn ToolContext>, args: Value) -> Result<Value, adk_core::AdkError> {
    let args: MyToolArgs = serde_json::from_value(args)
        .map_err(|e| adk_core::AdkError::Tool(format!("Invalid args: {}", e)))?;
    
    // Tool logic here
    Ok(json!({ "result": "success" }))
}

let tool = FunctionTool::new("tool_name", "Tool description", my_tool_fn)
    .with_parameters_schema::<MyToolArgs>();
```

### 4. Adding Tools to Agent
```rust
let agent = LlmAgentBuilder::new("agent_with_tools")
    .instruction("You are an assistant with tools.")
    .model(Arc::new(model))
    .tool(Arc::new(my_tool))
    .tool(Arc::new(another_tool))
    .build()?;
```

### 5. Streaming Response
```rust
use adk_runner::{Runner, RunnerConfig};
use adk_session::{CreateRequest, InMemorySessionService, SessionService};
use adk_core::Content;
use futures::StreamExt;

let session_service = Arc::new(InMemorySessionService::new());
let session = session_service.create(CreateRequest {
    app_name: "my_app".to_string(),
    user_id: "user_1".to_string(),
    session_id: None,
    state: std::collections::HashMap::new(),
}).await?;

let runner = Runner::new(RunnerConfig {
    app_name: "my_app".to_string(),
    agent: Arc::new(agent),
    session_service,
    artifact_service: None,
    memory_service: None,
    run_config: None,
})?;

let user_content = Content::new("user").with_text("Hello!");
let mut stream = runner.run("user_1".to_string(), session.id().to_string(), user_content).await?;

while let Some(event) = stream.next().await {
    match event {
        Ok(e) => {
            if let Some(content) = e.llm_response.content {
                for part in content.parts {
                    if let adk_core::Part::Text { text } = part {
                        print!("{}", text);
                    }
                }
            }
        }
        Err(e) => eprintln!("Error: {}", e),
    }
}
```

---

## Dependencies (Cargo.toml)

```toml
[dependencies]
adk-agent = "0.2"
adk-core = "0.2"
adk-model = { version = "0.2", features = ["openai"] }
adk-tool = "0.2"
adk-runner = "0.2"
adk-session = "0.2"
futures = "0.3"
schemars = "0.8"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1", features = ["full"] }
anyhow = "1"
```

---

## Migration from aisdk

| aisdk | adk-rust |
|-------|----------|
| `OpenAI::<Gpt4o>::builder()` (type-safe, no dynamic model) | `OpenAIClient::new(OpenAIConfig::new(key, "model"))` |
| No custom base URL | `OpenAIClient::compatible(OpenAICompatibleProvider { api_base, ... })` |
| `LanguageModelRequest::builder()` | `Runner::run()` with streaming |
| `#[tool]` macro | `FunctionTool::new()` with `JsonSchema` derive |

---

## Key Advantage

**adk-rust supports string-based model IDs** - unlike `aisdk` which uses type-state patterns, `adk-rust` allows specifying any model name as a string, making it perfect for OpenRouter and other compatible APIs.
