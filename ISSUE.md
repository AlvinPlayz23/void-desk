# Issue: AI Tool Calling Not Working in Chat

## Summary

Tool calling works in debug tests but fails or returns empty responses in the actual chat interface for certain prompts and providers.

---

## Timeline

### Initial State
- Migrated from ADK-Rust to a custom AI SDK built with `reqwest`
- Basic chat (saying "hi") works fine
- Tool calling was not responding

### Debugging Process

1. **Created debug commands** to test raw API requests and responses
2. **Found Issue #1**: Tool format was incorrect
   - Was: `{ "name": "...", "description": "...", "parameters": {...} }`
   - Should be: `{ "type": "function", "function": { "name": "...", ... } }`
   - **Fixed** in `types.rs`

3. **Found Issue #2**: Message content serialization
   - Tool result messages need `content` as plain string, not array
   - **Fixed** in `types.rs` with proper serialization

4. **Found Issue #3**: `AgentEvent::Done` not breaking the loop
   - The while loop processing stream events wasn't breaking on `Done`
   - Events were being sent but the command never completed
   - **Fixed** by adding `break` statements in `ai_commands.rs`

5. **Found Issue #4**: Streaming parser not emitting `Done`
   - Some providers (like Cerebras) don't send `[DONE]` marker
   - Parser only emitted `Done` on `[DONE]`, not on `finish_reason`
   - **Fixed** by emitting `Done` when any `finish_reason` is detected

6. **Tested with Agent Flow debug** - Tool calling NOW WORKS:
   ```
   [5] ToolStart: list_directory with input Object {"path": String(".")}
   [6] ToolResult: list_directory success=true result={...}
   [72] Done: 4 messages, final_text: 256 chars
   ```

---

## Current Issue

### Problem
When asking to "create a landing page for a car company in HTML", the response is empty or just whitespace.

### Debug Output
```
=== DEBUG AGENT FLOW ===
Model: gemini-3-flash-preview

=== AGENT EVENTS ===
[1] Done: 1 messages, final_text: 0 chars

=== TOTAL EVENTS: 1 ===
```

The stream returns immediately with `Done` and 0 content.

### Working vs Non-Working

| Prompt | Result |
|--------|--------|
| "hi" | ✅ Works |
| "list files in current directory" | ✅ Works (uses list_directory tool) |
| "read python.py" | ✅ Works (uses read_file tool) |
| "edit sss.txt" | ✅ Works (uses write_file tool) |
| "create a landing page for a car company in HTML" | ❌ Empty response |

---

## Possible Causes

### 1. Provider API Format Mismatch
- **Google's official Gemini API** uses a different format than OpenAI-compatible APIs
- Our SDK expects OpenAI format: `/v1/chat/completions`
- Google's native API uses: `/v1beta/models/MODEL:generateContent`
- **Solution**: Use OpenAI-compatible providers (OpenRouter, Cerebras) or add native Gemini support

### 2. Model-Specific Behavior
- Some models return `reasoning` tokens instead of `content` for complex tasks
- We added support for `reasoning` field in streaming parser
- But some models might exhaust tokens on reasoning without producing output

### 3. Token/Context Limits
- Long generation requests might hit token limits
- The model might be trying to generate too much content

### 4. API Error Not Surfaced
- The API might be returning an error in the response body
- We might not be catching/displaying it properly

---

## Fixes Applied

### 1. Tool Format (types.rs)
```rust
// Before
pub struct Tool {
    pub name: String,
    pub description: String,
    pub parameters: Value,
}

// After
pub struct Tool {
    #[serde(rename = "type")]
    pub kind: String,  // "function"
    pub function: ToolFunction,
}
```

### 2. Message Serialization (types.rs)
- Changed `content` from `Vec<ContentBlock>` to `Option<String>`
- Added proper handling for tool result messages

### 3. Stream Done Handling (ai_commands.rs)
```rust
Ok(AgentEvent::Done { final_text: _, messages }) => {
    session_store.replace_messages(&session_id, messages).await;
    break;  // Added this
}
```

### 4. Finish Reason Detection (streaming.rs)
```rust
// Emit Done for any finish_reason (stop, tool_calls, etc.)
events.push(Ok(StreamEvent::Done));
```

### 5. Reasoning Support (streaming.rs)
```rust
// Also check for reasoning content (used by some models)
if let Some(reasoning) = delta.get("reasoning").and_then(|v| v.as_str()) {
    events.push(Ok(StreamEvent::TextDelta(reasoning.to_string())));
}
```

---

## Debug Tools Added

### 1. API Test (`debug_tool_call`)
Tests raw non-streaming API request/response with tool calling

### 2. Stream Test (`debug_stream_response`)
Tests streaming SSE parsing with tool calls

### 3. Agent Flow (`debug_agent_flow`)
Tests full agent loop including tool execution

Access via: AI Panel → Bug icon → Debug buttons

---

## Recommended Next Steps

1. **Use OpenAI-compatible providers** for now:
   - OpenRouter (`https://openrouter.ai/api`)
   - Cerebras (`https://api.cerebras.ai`)
   - Together AI, Groq, etc.

2. **Add native Gemini API support** (future):
   - Create separate client for Google's API format
   - Handle different request/response structure

3. **Improve error handling**:
   - Log raw API responses when content is empty
   - Surface API errors to the user

4. **Add request/response logging**:
   - Option to log full request/response for debugging
   - Store in debug logs visible in UI

---

## Files Modified

- `src-tauri/src/sdk/types.rs` - Message and Tool structures
- `src-tauri/src/sdk/streaming.rs` - SSE parsing, reasoning support
- `src-tauri/src/sdk/agent.rs` - Agent loop, logging
- `src-tauri/src/commands/ai_commands.rs` - Done event handling
- `src-tauri/src/commands/ai_debug.rs` - Debug commands
- `src/components/ai/AIChat.tsx` - Debug panel UI
