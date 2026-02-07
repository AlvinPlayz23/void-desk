# VoiDesk Custom AI SDK Plan

> Ditching ADK-Rust in favor of a custom, lightweight AI inference SDK built with `reqwest` — full control, zero bloat.

---

## 🎯 Goals

1. **Remove all ADK dependencies** — No more `adk-*` crates cluttering Cargo.toml
2. **Build custom SDK** — Lightweight, purpose-built for VoiDesk
3. **Maintain feature parity** — Keep tool calling, agent loop, streaming, sessions
4. **Improve DX** — Simpler API, easier debugging, transparent control flow

---

## 📁 New Module Structure

```
src-tauri/src/
├── sdk/                          # NEW: Custom AI SDK
│   ├── mod.rs                    # Module exports
│   ├── client.rs                 # HTTP client (reqwest)
│   ├── types.rs                  # Request/Response types
│   ├── tools.rs                  # Tool trait & registry
│   ├── agent.rs                  # Agent loop logic
│   ├── streaming.rs              # SSE streaming support
│   └── session.rs                # Session management
│
├── commands/
│   ├── mod.rs
│   ├── ai_commands.rs            # MODIFY: Use new SDK
│   ├── ai_service.rs             # REWRITE: Simple wrapper
│   └── ai_tools.rs               # KEEP: Tool implementations
│
└── ...
```

---

## 🔧 Core Components

### 1. Types (`sdk/types.rs`)

Basic types matching provider APIs (OpenAI-compatible format):

```rust
// Message structure
pub struct Message {
    pub role: String,           // "user" | "assistant" | "system"
    pub content: Vec<ContentBlock>,
}

pub enum ContentBlock {
    Text { text: String },
    ToolUse { id: String, name: String, input: Value },
    ToolResult { tool_use_id: String, content: String },
}

// API Request/Response
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub tools: Option<Vec<Tool>>,
    pub stream: bool,
    pub max_tokens: Option<u32>,
}

pub struct ChatResponse {
    pub id: String,
    pub choices: Vec<Choice>,
    pub usage: Option<Usage>,
}

pub struct Tool {
    pub name: String,
    pub description: String,
    pub parameters: Value,  // JSON Schema
}
```

### 2. HTTP Client (`sdk/client.rs`)

Simple reqwest wrapper for API calls:

```rust
pub struct AIClient {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
    model: String,
}

impl AIClient {
    pub fn new(api_key: &str, base_url: &str, model: &str) -> Self;
    
    /// Non-streaming completion
    pub async fn complete(&self, request: ChatRequest) -> Result<ChatResponse>;
    
    /// Streaming completion (returns async stream)
    pub async fn stream(&self, request: ChatRequest) 
        -> Result<impl Stream<Item = Result<StreamEvent>>>;
}
```

### 3. Tool System (`sdk/tools.rs`)

Trait-based tools (inspired by example-reqwest):

```rust
#[async_trait]
pub trait ToolExecutor: Send + Sync {
    /// Tool definition for the API
    fn definition(&self) -> Tool;
    
    /// Execute the tool
    async fn execute(&self, input: Value) -> Result<String>;
}

/// Tool registry
pub struct ToolRegistry {
    tools: HashMap<String, Arc<dyn ToolExecutor>>,
}

impl ToolRegistry {
    pub fn register(&mut self, tool: Arc<dyn ToolExecutor>);
    pub fn get(&self, name: &str) -> Option<&Arc<dyn ToolExecutor>>;
    pub fn definitions(&self) -> Vec<Tool>;
}
```

### 4. Agent Loop (`sdk/agent.rs`)

The core agentic behavior:

```rust
pub struct Agent {
    client: AIClient,
    tools: ToolRegistry,
    system_prompt: Option<String>,
    max_iterations: usize,
}

impl Agent {
    pub fn new(client: AIClient) -> Self;
    pub fn with_tool(self, tool: Arc<dyn ToolExecutor>) -> Self;
    pub fn with_system_prompt(self, prompt: String) -> Self;
    
    /// Run the agent loop (think → act → observe)
    pub async fn run(&self, user_message: String) -> Result<String>;
    
    /// Run with streaming output
    pub async fn run_streaming(&self, user_message: String) 
        -> Result<impl Stream<Item = AgentEvent>>;
}

pub enum AgentEvent {
    TextDelta(String),           // Streaming text
    ToolStart { name: String },  // Tool execution started
    ToolResult { name: String, result: String }, // Tool done
    Done,
}
```

### 5. Streaming (`sdk/streaming.rs`)

SSE parsing for streaming responses:

```rust
pub enum StreamEvent {
    TextDelta(String),
    ToolCall { id: String, name: String, arguments: String },
    Done,
}

/// Parse SSE stream from provider
pub fn parse_sse_stream(
    byte_stream: impl Stream<Item = Result<Bytes>>
) -> impl Stream<Item = Result<StreamEvent>>;
```

### 6. Session Management (`sdk/session.rs`)

Simple in-memory session store:

```rust
pub struct Session {
    pub id: String,
    pub messages: Vec<Message>,
    pub created_at: DateTime<Utc>,
}

pub struct SessionStore {
    sessions: RwLock<HashMap<String, Session>>,
}

impl SessionStore {
    pub async fn create(&self, id: Option<String>) -> Session;
    pub async fn get(&self, id: &str) -> Option<Session>;
    pub async fn append(&self, id: &str, message: Message);
    pub async fn clear(&self, id: &str);
}
```

---

## 📦 Dependency Changes

### Remove (from Cargo.toml)
```toml
# DELETE these:
adk-rust = { version = "0.2", features = ["openai"] }
adk-agent = "0.2"
adk-core = "0.2"
adk-model = { version = "0.2", features = ["openai"] }
adk-tool = "0.2"
adk-runner = "0.2"
adk-session = "0.2"
schemars = "0.8"
```

### Keep/Add
```toml
# Already have:
reqwest = { version = "0.12", features = ["json", "stream"] }
tokio = { version = "1", features = ["full"] }
tokio-stream = "0.1"
futures = "0.3"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
anyhow = "1"

# Add:
async-trait = "0.1"               # For ToolExecutor trait
chrono = { version = "0.4", features = ["serde"] }  # For timestamps
uuid = { version = "1", features = ["v4"] }         # For session IDs
```

---

## 🔄 Migration Path

### Phase 1: Create SDK Module
1. Create `src/sdk/` directory structure
2. Implement `types.rs` (basic types)
3. Implement `client.rs` (reqwest HTTP)
4. Implement `tools.rs` (tool trait + registry)

### Phase 2: Agent & Streaming
5. Implement `agent.rs` (agent loop)
6. Implement `streaming.rs` (SSE parsing)
7. Implement `session.rs` (session store)

### Phase 3: Integration
8. Rewrite `ai_service.rs` to use new SDK
9. Update `ai_commands.rs` to use new types
10. Migrate existing tools from `ai_tools.rs` to new trait

### Phase 4: Cleanup
11. Remove ADK dependencies from Cargo.toml
12. Delete vendor directory if not needed
13. Clean up unused imports

---

## 🎨 API Usage Example

After migration, the API will look like:

```rust
// Create client
let client = AIClient::new(
    &api_key,
    "https://openrouter.ai/api",
    "anthropic/claude-3.5-sonnet"
);

// Build agent with tools
let mut agent = Agent::new(client)
    .with_system_prompt(SYSTEM_PROMPT.to_string())
    .with_tool(Arc::new(ReadFileTool::new(project_path)))
    .with_tool(Arc::new(WriteFileTool::new(project_path)))
    .with_tool(Arc::new(RunCommandTool::new(project_path)))
    .with_max_iterations(10);

// Run agent loop
let response = agent.run("Create a new Rust file".to_string()).await?;

// Or with streaming
let mut stream = agent.run_streaming("Explain this code".to_string()).await?;
while let Some(event) = stream.next().await {
    match event {
        AgentEvent::TextDelta(text) => print!("{}", text),
        AgentEvent::ToolStart { name } => println!("[Using {}...]", name),
        AgentEvent::Done => break,
    }
}
```

---

## ✅ Benefits

| Aspect | ADK-Rust | Custom SDK |
|--------|----------|------------|
| **Dependencies** | 8+ crates | 2-3 new crates |
| **Binary size** | Larger | Smaller |
| **Control** | Limited | Full |
| **Debugging** | Black box | Transparent |
| **Customization** | Hard | Easy |
| **Provider support** | Fixed | Any OpenAI-compatible |

---

## 📋 Verification Plan

### Build Verification
```bash
cd src-tauri
cargo check     # Ensure it compiles
cargo build     # Full build test
```

### Unit Tests
- Test `AIClient::complete()` with mock server
- Test `ToolRegistry::register()` and `get()`
- Test `Agent::run()` with mock responses
- Test SSE stream parsing

### Integration Tests
- End-to-end: Send message → Receive response
- Tool execution: Agent uses read_file tool
- Streaming: Verify SSE events parse correctly
- Session persistence: Messages preserved across calls

### Manual Testing
1. Start the Tauri app
2. Open a project
3. Send an AI message
4. Verify tool calls work (ask it to read a file)
5. Verify streaming works (see text appear progressively)

---

## 🚀 Next Steps

1. **Approve this plan** — Let me know if structure looks good
2. **Start Phase 1** — Create the SDK module skeleton
3. **Iterate** — Build incrementally, test each component

---

*Reference: See `example-reqwest/` for the proof-of-concept implementation this is based on.*
