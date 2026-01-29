# Feature Log: 2026-01-29

## Summary

1. **Permanent AI Debug Logging** - Added tracing-based log sink that writes to `logs/ai-debug.log`.
2. **AI Stream Error Hardening** - Improved SSE parsing and error handling for OpenAI-compatible streams.
3. **Tool Call ID Fixes** - Ensured tool call IDs are always present when sending tool responses.
4. **Vendor Overrides** - Patched `adk-model` and `async-openai` via Cargo `[patch.crates-io]`.

---

## 1. Permanent AI Debug Logging

### Overview
Implemented a Tauri-side tracing setup to persist AI debug logs to disk, improving post-mortem debugging and provider compatibility analysis.

### Files Created

| File | Purpose |
|------|---------|
| `src-tauri/src/tracing_setup.rs` | Initializes tracing to `logs/ai-debug.log` with non-blocking writer |

### Files Modified

| File | Changes |
|------|---------|
| `src-tauri/src/lib.rs` | Initializes tracing on startup |

### Dependencies Added

**Cargo (Rust):**
```toml
tracing = "0.1"
tracing-appender = "0.2"
tracing-subscriber = { version = "0.3", features = ["env-filter", "fmt"] }
```

### Implementation Details

```rust
tracing_subscriber::fmt()
    .with_env_filter(filter)
    .with_writer(non_blocking)
    .try_init()
    .ok();
```

---

## 2. AI Stream Error Hardening

### Overview
Handled SSE error payloads that previously caused "missing field `choices`" deserialization failures by detecting wrapped error objects before deserializing as normal stream chunks.

### Files Modified

| File | Changes |
|------|---------|
| `src-tauri/vendor/async-openai-0.27.2/src/client.rs` | Added SSE error payload detection for `WrappedError` |
| `src-tauri/vendor/async-openai-0.27.2/src/error.rs` | Imported serde error trait for custom errors |
| `src-tauri/vendor/adk-model-0.2.0/src/openai/client.rs` | Skip stream chunks with empty `choices` |

### Architecture Decisions

1. **Prefer early error detection over synthetic choices** - Safer than fabricating response payloads.

---

## 3. Tool Call ID Fixes

### Overview
Added deterministic fallback tool call IDs during conversion to prevent provider errors when tool responses are missing corresponding IDs.

### Files Modified

| File | Changes |
|------|---------|
| `src-tauri/vendor/adk-model-0.2.0/src/openai/convert.rs` | Fallback tool call IDs for both streaming and non-streaming cases |

### Implementation Details

```rust
let call_id = if tc.id.is_empty() {
    format!("call_{}", tc.function.name)
} else {
    tc.id.clone()
};
```

---

## 4. Vendor Overrides

### Overview
Vendored `adk-model` and `async-openai` to allow local fixes without modifying global Cargo registry content.

### Files Modified

| File | Changes |
|------|---------|
| `src-tauri/Cargo.toml` | Added `[patch.crates-io]` overrides for local vendored crates |

### Summary of All Changes

#### New Files (1)
- `src-tauri/src/tracing_setup.rs`

#### Modified Files (6)
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/vendor/async-openai-0.27.2/src/client.rs`
- `src-tauri/vendor/async-openai-0.27.2/src/error.rs`
- `src-tauri/vendor/adk-model-0.2.0/src/openai/client.rs`
- `src-tauri/vendor/adk-model-0.2.0/src/openai/convert.rs`

#### Dependencies Added
- **Rust**: `tracing`, `tracing-appender`, `tracing-subscriber`

#### Verification
- `npm run build`
