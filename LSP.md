# LSP Integration Documentation

## Overview
VoiDesk integrates the **Language Server Protocol (LSP)** to provide VSCode-grade intelligence (Autocomplete, Hover, etc.) while maintaining high performance. The integration uses a Rust-based bridge that manages language server processes and communicates with the React/CodeMirror frontend.

---

## 🏗️ Architecture

### 1. Backend (Rust - Tauri)
Located in `src-tauri/src/lsp/`, the backend handles the heavy lifting of process management and protocol framing.

- **`transport.rs`**: Handles JSON-RPC message framing over `stdin` and `stdout`.
    - Uses `cmd /C` on Windows to correctly spawn `.cmd` batch files (required for npm-installed language servers).
    - Implements `Content-Length` header parsing to extract JSON-RPC bodies.
    - **Background Reader**: A `spawn_blocking` task continuously reads server responses and routes them by request ID using oneshot channels.
    - **Server Request Handling**: Responds to `workspace/configuration`, `client/registerCapability`, and other server-initiated requests.
- **`manager.rs`**: The central controller.
    - Manages a lifecycle map of `LanguageServer` instances.
    - Tracks document versions (required for synchronization).
    - Handles the `initialize` handshake with proper `rootUri`, `workspaceFolders`, and capabilities.
- **`protocol.rs`**: Helper utilities for constructing LSP-compliant JSON objects (`CompletionParams`, `HoverParams`, `DidChangeTextDocumentParams`, etc.).
    - Path canonicalization for consistent URI formatting across Windows.
- **`lsp_commands.rs`**: The Tauri API surface. Exposes commands like `lsp_did_change`, `lsp_completion`, and `lsp_hover` to the frontend.

### 2. Frontend (React + CodeMirror 6)
- **`useLsp.ts`**: A custom React hook that abstracts the Tauri `invoke` calls. It provides a clean API for the UI to interact with the LSP bridge.
- **`CodeEditor.tsx`**: 
    - **Sync Engine**: Uses an `updateListener` and a 300ms **debounce** to send `textDocument/didChange` notifications to the backend as the user types.
    - **Autocomplete**: A custom `autocompletion` source that queries the LSP bridge.
    - **Hover**: Uses `hoverTooltip` to display type definitions and documentation in a custom-styled popup.

---

## 🛠️ Logic & Synchronization
The most critical part of the integration is **Document Synchronization**. 

**The Flow:**
1. **Open**: Editor calls `didOpen`. Rust spawns the language server (e.g., `typescript-language-server`).
2. **Initialize**: Server sends `workspace/configuration` requests - we respond with empty config to unblock the server.
3. **Type**: User types. CodeMirror triggers `updateListener`.
4. **Debounce**: After 300ms of inactivity, `didChange` sends the full document content and an incremented version number to the LSP.
5. **Request**: User types `.` or triggers completion. Frontend sends `lsp_completion`. 
6. **Response**: Background reader routes the matching response by ID via oneshot channel to the waiting request.

---

## 🚦 Current State
| Feature | Status | Notes |
|---------|--------|-------|
| Windows Spawning | ✅ Fixed | Now handles `.cmd` files via `cmd /C` |
| Autocomplete | ✅ Working | Integrated with CodeMirror source |
| Hover Tooltips | ✅ Working | Markdown-ready tooltips |
| Sync (`didChange`) | ✅ Working | 300ms debounced full-sync |
| TypeScript/JS | ✅ Supported | Requires `typescript-language-server` |
| Server Requests | ✅ Handled | `workspace/configuration`, `client/registerCapability` |
| Request Routing | ✅ Fixed | Oneshot channels prevent response stealing |
| URI Formatting | ✅ Fixed | Proper `file:///C:/path` on Windows |
| Diagnostics | 🚧 Pending | Error squiggles are Phase 2 |

---

## ⚠️ Challenges & Solutions

### 1. Spawning on Windows
**Problem**: Rust's `Command` cannot find `.cmd` files in `PATH` directly.
**Solution**: Prefix with `cmd /C` to properly spawn batch files.

### 2. Initialization Noise
**Problem**: Servers spam notifications (telemetry, progress) immediately after start.
**Solution**: Background reader filters and routes messages by type (response vs notification vs server request).

### 3. Empty Completions (Response Stealing)
**Problem**: Multiple concurrent requests (hover + completion) competed for the same response channel. One request would consume another's response.
**Solution**: Implemented proper request/response routing with `HashMap<u64, oneshot::Sender<Value>>`. Each request gets its own channel, and the background reader routes responses by ID.

### 4. Server Requests Blocking Client
**Problem**: `typescript-language-server` sends `workspace/configuration` requests and blocks until we respond. We were ignoring them, causing all subsequent requests to timeout.
**Solution**: Handle server requests in the background reader and respond appropriately:
- `workspace/configuration` → Return empty config `[{}]` for each item
- `client/registerCapability` → Return `null` (accept)
- `window/workDoneProgress/create` → Return `null` (accept)

### 5. Windows URI Formatting
**Problem**: Manual string formatting produced `file://C:/...` instead of `file:///C:/...`.
**Solution**: Use `lsp_types::Url::from_directory_path()` and `Url::from_file_path()` which handle platform-specific URI formatting correctly.

---

## 🗓️ Future Phases

### Phase 2: Intelligence & Navigation
- **Diagnostics (Error Squiggles)**: 
    - Implement a listener for `textDocument/publishDiagnostics`.
    - Map LSP diagnostic ranges to CodeMirror `Decoration` sets.
    - Add a "Problems" panel in the UI to list all errors project-wide.
- **Go-To-Definition**:
    - Implement `textDocument/definition` request.
    - Add logic to open new tabs if the definition is in a different file.
    - Support "Peek Definition" UI.
- **Find References**:
    - Implement `textDocument/references`.
    - Create a side-panel tree view for reference results.

### Phase 3: Full IDE Experience & Optimization
- **Multi-Language Rollout**:
    - Build specialized handlers for `rust-analyzer` (requires custom initialization options).
    - Add `pyright` (Python) and `clangd` (C++) defaults.
- **LSP Lifecycle Optimization**:
    - Implement **Idle Shutdown**: Kill language servers after 15 minutes of inactivity to save RAM.
    - Implement **Incremental Synchronization**: Switch from full-content `didChange` to byte-diff sync for large files.
- **Signature Help**:
    - Show function parameter hints as you type opening parentheses `(`.

---

## 📁 Key Files Reference

| File | Purpose |
|------|---------|
| `src-tauri/src/lsp/transport.rs` | JSON-RPC framing, background reader, server request handling |
| `src-tauri/src/lsp/manager.rs` | Server lifecycle, initialize handshake, request dispatch |
| `src-tauri/src/lsp/protocol.rs` | LSP parameter construction, URI formatting |
| `src-tauri/src/commands/lsp_commands.rs` | Tauri command bindings |
| `src/hooks/useLsp.ts` | React hook for LSP operations |
| `src/components/editor/CodeEditor.tsx` | CodeMirror integration for autocomplete/hover |
