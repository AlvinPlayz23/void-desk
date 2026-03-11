# Tool Call Error Recovery

## Problem

When the AI model (e.g., Kimi K2.5 via OpenRouter) produced malformed tool calls, the entire agent stream would crash and show an error to the user with no way to recover. Specifically:

1. **Leading spaces in tool call IDs**: Kimi K2.5 returned tool call IDs like `" functions.list_directory:0"` (note leading space). When the agent sent tool results back to the API with this malformed ID, the API rejected it with a `400 Bad Request: Expecting ',' delimiter` JSON parse error.

2. **Stream timeout after tool execution**: The default HTTP timeout was 30 seconds. Models with extended reasoning (like Kimi K2.5) often take longer than 30s to respond after receiving tool results, causing `error decoding response body` errors.

3. **Fatal error handling**: Both the streaming and non-streaming agent loops treated any API error or stream error as fatal — immediately killing the agent and returning the raw error to the user.

## Changes Made

### 1. Trim tool call IDs and names (`src-tauri/src/sdk/stream/parse.rs`)

Tool call IDs and function names from model responses are now `.trim()`-ed before being stored. This prevents whitespace issues from models that produce non-standard formatting.

```rust
let id = tool_call.id.clone().unwrap_or_default().trim().to_string();
let name = tool_call.function.as_ref()
    .and_then(|f| f.name.clone())
    .map(|n| n.trim().to_string())
    .unwrap_or_default();
```

### 2. Increased HTTP timeout (`src-tauri/src/sdk/transport/http.rs`)

Timeout increased from 30 seconds to 5 minutes (300,000ms) to accommodate reasoning models that think longer after tool calls.

```rust
timeout_ms: 300_000, // was 30_000
```

### 3. Error recovery in streaming agent loop (`src-tauri/src/sdk/agent.rs`)

Instead of crashing on API/stream errors, the agent now:

- **On API request failure** (e.g., 400 Bad Request): Feeds the error back to the LLM as a user message asking it to self-correct, then `continue`s to the next iteration.
- **On mid-stream error** (e.g., timeout, decode error): Saves any partial assistant text, feeds the error as a user message, and `continue`s.
- Shows a `*[Retrying after error...]*` indicator in the chat so the user knows what happened.

The same recovery was applied to the non-streaming `run()` method.

### 4. Unlimited tool call iterations (`src-tauri/src/sdk/agent.rs`)

Default `max_iterations` changed from `10` to `usize::MAX` so the agent can perform as many tool calls as needed without hitting an artificial limit. The inline completions agent still uses `.with_max_iterations(1)` since it's single-shot.

## Flow

```
Model returns tool call with malformed ID
  → ID gets trimmed (fix #1)
  → Tool executes, result sent back
  → If API rejects with 400:
      → Error fed back to LLM as user message (fix #3)
      → LLM retries with corrected approach
      → User sees "[Retrying after error...]" in chat
```
