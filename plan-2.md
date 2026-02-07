# AI SDK Rewrite Plan (Fresh Architecture)

## Summary
This plan proposes a clean, modular architecture for the custom AI SDK used by VoiDesk. It focuses purely on structure, responsibilities, and interfaces. It avoids behavioral policy decisions (no tool‑forcing, no truncation handling, no retry strategy, no UI warnings). The goal is a clear, maintainable foundation that can evolve without entangling responsibilities.

## Goals
- Separate concerns: transport, provider adaptation, streaming parsing, orchestration, tools, and session storage.
- Define stable, minimal interfaces between layers.
- Keep SDK internals provider‑agnostic and UI‑agnostic.

## Non‑Goals
- Defining tool usage policy or forcing behavior.
- Defining error or retry policies.
- Defining UI behaviors (warnings, banners, etc.).
- Adding multi‑provider support beyond OpenAI‑compatible format in this rewrite.

---

## Proposed Module Layout

```
src-tauri/src/sdk/
├── core/
│   ├── mod.rs
│   ├── types.rs
│   └── events.rs
├── provider/
│   ├── mod.rs
│   └── openai_compatible.rs
├── transport/
│   ├── mod.rs
│   └── http.rs
├── stream/
│   ├── mod.rs
│   └── parse.rs
├── tools/
│   ├── mod.rs
│   └── registry.rs
├── agent.rs
├── session.rs
└── mod.rs
```

---

## Core Layer (`sdk/core`)
**Purpose:** shared, provider‑agnostic types and events.

### `core/types.rs`
- `Message`
- `Tool` / `ToolFunction`
- `ToolCall` / `ToolCallFunction`
- `ChatRequest` / `ChatResponse` / `Choice` / `Usage`

### `core/events.rs`
- `StreamEvent`
  - `TextDelta(String)`
  - `ToolCall { id, name, arguments }`
  - `Done`
  - `Raw(String)` (debug only)

**Notes:**
- Core types should not depend on transport, agent, or UI.
- Serialization/deserialization lives here to avoid duplication.

---

## Provider Layer (`sdk/provider`)
**Purpose:** adapt OpenAI‑compatible protocol into SDK types.

### `provider/mod.rs`
Defines the provider interface used by the Agent and client wrappers:

```
trait Provider {
    fn id(&self) -> &'static str;
    fn build_request(&self, req: ChatRequest) -> ProviderRequest;
    async fn complete(&self, req: ChatRequest) -> Result<ChatResponse>;
    async fn stream(&self, req: ChatRequest, debug_raw: bool) -> Result<impl Stream<Item = Result<StreamEvent>>>;
}
```

### `provider/openai_compatible.rs`
Concrete implementation for OpenAI‑compatible APIs.

---

## Transport Layer (`sdk/transport`)
**Purpose:** HTTP execution and response handling, independent of provider logic.

### `transport/http.rs`
- Responsible for:
  - building and sending HTTP requests
  - returning raw text for non‑streaming
  - returning raw byte stream for streaming

---

## Streaming Layer (`sdk/stream`)
**Purpose:** convert SSE byte streams into `StreamEvent` values.

### `stream/parse.rs`
- Parses SSE frames
- Emits normalized `StreamEvent`s
- Does not include provider or agent logic

---

## Tools Layer (`sdk/tools`)
**Purpose:** tool registration and execution contracts.

### `tools/mod.rs`
- `ToolExecutor` trait
- `ToolDefinition`

### `tools/registry.rs`
- `ToolRegistry`
  - register tool
  - list tool definitions
  - lookup executor by name

---

## Agent (`sdk/agent.rs`)
**Purpose:** orchestrate model calls + tool execution + history updates.

Responsibilities:
- Builds `ChatRequest` using core types
- Delegates network calls to Provider
- Streams events and buffers text
- Executes tools via `ToolRegistry`
- Returns final `AgentResult` with updated messages

The agent should not own provider transport details or parsing logic.

---

## Session Store (`sdk/session.rs`)
**Purpose:** in‑memory session/history store.

Responsibilities:
- CRUD sessions
- Append/replace messages
- Track timestamps

---

## Public SDK Surface (`sdk/mod.rs`)
Expose minimal, stable imports:
- `Agent`
- `AgentEvent`
- `AIClient` (if retained as a convenience wrapper)
- `SessionStore`
- Core types

---

## Command Layer Integration (Tauri)
No structural change required, but SDK usage should be routed through:
- `AIService::create_agent` (creates provider + agent + tools)
- `Agent::run_streaming` for UI streaming
- `Agent::run` for non‑streaming

---

## Migration Steps (High‑Level)
1. Introduce new module structure under `sdk/`.
2. Move types into `core` and update imports.
3. Implement provider abstraction and OpenAI‑compatible provider.
4. Move streaming parse logic into `stream/parse.rs`.
5. Refactor Agent to use Provider + ToolRegistry.
6. Update command layer to use new SDK surface.
7. Remove old SDK wiring once new layers compile.

---

## Acceptance Criteria
- Code compiles with the new module boundaries.
- Responsibilities are cleanly separated (provider vs transport vs agent vs tools).
- No policy logic embedded in the SDK architecture.
