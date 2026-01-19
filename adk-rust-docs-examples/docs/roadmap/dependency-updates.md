# Dependency Updates Roadmap

This document tracks major dependency updates that require significant code changes.

## Completed Updates (v0.1.5+)

| Dependency | Old | New | Date | Notes |
|------------|-----|-----|------|-------|
| axum | 0.7 | 0.8 | 2025-12-10 | Route path syntax `:param` → `{param}` |
| tower-http | 0.5 | 0.6 | 2025-12-10 | `TimeoutLayer::new` deprecated |
| thiserror | 1.0 | 2.0 | 2025-12-10 | No breaking changes in our usage |

---

## Pending Updates

### 1. OpenTelemetry Stack (0.21 → 0.31)

**Priority:** Medium
**Effort:** 1-2 hours
**Risk:** Medium (isolated to adk-telemetry)

**Current Versions:**
```toml
opentelemetry = "0.21"
opentelemetry_sdk = "0.21"
opentelemetry-otlp = "0.14"
tracing-opentelemetry = "0.22"
```

**Target Versions:**
```toml
opentelemetry = "0.31"
opentelemetry_sdk = "0.31"
opentelemetry-otlp = "0.31"
tracing-opentelemetry = "0.32"
```

**Breaking Changes:**
1. Pipeline API completely rewritten - `new_pipeline()` removed
2. Resource creation uses new builder pattern
3. Tracer/Meter provider initialization changed
4. OTLP exporter configuration API updated
5. Metrics SDK now stable with API changes
6. Logs SDK now stable with new logging approach

**Files Affected:**
- `adk-telemetry/src/init.rs` (~120 lines) - OTLP pipeline setup
- `adk-telemetry/src/lib.rs` (~43 lines) - Re-exports
- `adk-telemetry/src/spans.rs` (~89 lines) - Span helpers

**Migration Steps:**
1. Update Cargo.toml versions
2. Rewrite `init_with_otlp()` using new pipeline API
3. Update metric provider setup
4. Update resource creation
5. Test OTLP export with local collector
6. Update documentation examples

**Resources:**
- [OpenTelemetry Rust Changelog](https://github.com/open-telemetry/opentelemetry-rust/blob/main/CHANGELOG.md)
- [Migration Guide](https://github.com/open-telemetry/opentelemetry-rust/blob/main/docs/release_0.30.md)

---

### 2. async-openai (0.27 → 0.31)

**Priority:** Low
**Effort:** 3-4 hours
**Risk:** High (affects OpenAI provider)

**Current Version:**
```toml
async-openai = "0.27"
```

**Target Version:**
```toml
async-openai = "0.31"
```

**Breaking Changes:**
1. **Client creation API changed**
   - Old: `Client::with_config(OpenAIConfig::new()...)`
   - New: Similar but different builder methods

2. **Types module restructured**
   - `CreateChatCompletionRequestArgs` location changed
   - `FinishReason` moved or renamed
   - `ChatCompletionRequestMessage` variants changed

3. **Tool/Function calling types restructured**
   - `FunctionObject`, `ChatCompletionTool` API changes

4. **Response types changed**
   - `CreateChatCompletionResponse` structure different

**Files Affected:**
- `adk-model/src/openai/client.rs` (~316 lines) - OpenAI/Azure clients
- `adk-model/src/openai/convert.rs` (~297 lines) - Type conversions
- `adk-model/src/openai/config.rs` (~96 lines) - Configuration
- `adk-realtime/src/openai/` - Realtime API types

**Migration Steps:**
1. Study new async-openai API documentation
2. Update client creation in `client.rs`
3. Rewrite type conversions in `convert.rs`
4. Update streaming response handling
5. Test all OpenAI examples:
   - `openai_basic`
   - `openai_tools`
   - `openai_workflow`
   - `openai_structured`
6. Test Azure OpenAI compatibility
7. Update realtime API if affected

**Resources:**
- [async-openai Documentation](https://docs.rs/async-openai/latest/async_openai/)
- [async-openai GitHub](https://github.com/64bit/async-openai)

---

### 3. rmcp (0.9 → 0.11)

**Priority:** Low
**Effort:** 1-2 hours
**Risk:** Medium (affects MCP tool integration)

**Current Version:**
```toml
rmcp = "0.9"
```

**Target Version:**
```toml
rmcp = "0.11"
```

**Files Affected:**
- `adk-tool/src/mcp/` - MCP toolset integration

**Migration Steps:**
1. Review rmcp changelog for breaking changes
2. Update MCP client/server types
3. Test MCP tool examples

---

### 4. rustyline (14 → 17)

**Priority:** Low
**Effort:** 30 minutes
**Risk:** Low (CLI only)

**Current Version:**
```toml
rustyline = "14.0"
```

**Target Version:**
```toml
rustyline = "17.0"
```

**Files Affected:**
- `adk-cli/src/` - CLI REPL implementation

**Migration Steps:**
1. Update version
2. Fix any API changes
3. Test CLI REPL functionality

---

## Update Strategy

### Recommended Order

1. **rustyline** - Lowest risk, quick win
2. **rmcp** - Medium risk, isolated to MCP tools
3. **opentelemetry** - Medium risk, isolated to telemetry
4. **async-openai** - Highest risk, defer or do carefully

### Testing Requirements

For each update:
1. `cargo check --all-features`
2. `cargo test --all-features`
3. `cargo clippy --all-targets --all-features`
4. Manual testing of affected examples

### Version Pinning Policy

- Pin major versions in workspace `Cargo.toml`
- Allow minor/patch updates via `cargo update`
- Document breaking changes in CHANGELOG.md
