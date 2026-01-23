# LSP Integration Plan for VoiDesk

## Overview

This document outlines the plan to integrate Language Server Protocol (LSP) support into VoiDesk, enabling intelligent code features like autocomplete, go-to-definition, hover tooltips, and inline diagnostics.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         VoiDesk Application                              │
│  ┌───────────────────────────────────────────────────────────────────┐  │
│  │                    React Frontend (Vite)                          │  │
│  │  ┌─────────────────┐  ┌─────────────────┐  ┌──────────────────┐  │  │
│  │  │ CodeMirror 6    │  │ LSP Extensions  │  │ Diagnostics      │  │  │
│  │  │ Editor          │◄─┤ • Autocomplete  │  │ Panel            │  │  │
│  │  │                 │  │ • Hover         │  │                  │  │  │
│  │  │                 │  │ • Go-to-def     │  │                  │  │  │
│  │  └─────────────────┘  └────────┬────────┘  └──────────────────┘  │  │
│  │                                │                                  │  │
│  │                    Tauri invoke() / listen()                      │  │
│  └────────────────────────────────┼──────────────────────────────────┘  │
│                                   │                                      │
│  ┌────────────────────────────────┼──────────────────────────────────┐  │
│  │                    Rust Backend (Tauri)                           │  │
│  │  ┌─────────────────────────────┴─────────────────────────────┐   │  │
│  │  │                    LSP Manager                             │   │  │
│  │  │  • Process spawning & lifecycle                            │   │  │
│  │  │  • JSON-RPC message routing                                │   │  │
│  │  │  • Document synchronization                                │   │  │
│  │  │  • Request/response correlation                            │   │  │
│  │  └───────────────────────────────────────────────────────────┘   │  │
│  │           │                    │                    │             │  │
│  │           ▼                    ▼                    ▼             │  │
│  │  ┌─────────────┐      ┌─────────────┐      ┌─────────────┐       │  │
│  │  │ typescript- │      │   pyright   │      │   rust-     │       │  │
│  │  │ language-   │      │             │      │   analyzer  │       │  │
│  │  │ server      │      │             │      │             │       │  │
│  │  └─────────────┘      └─────────────┘      └─────────────┘       │  │
│  │       (stdio)              (stdio)              (stdio)           │  │
│  └───────────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Components

1. **LSP Manager (Rust)**: Central coordinator that spawns, manages, and communicates with language servers
2. **Document Sync**: Keeps editor content synchronized with language servers via `textDocument/*` notifications
3. **Request Router**: Correlates requests/responses using JSON-RPC IDs
4. **CodeMirror Extensions**: Frontend extensions that trigger LSP requests and display results

---

## 2. Language Server Selection

| Language | Server | Installation | Memory (Idle) | Notes |
|----------|--------|--------------|---------------|-------|
| TypeScript/JavaScript | `typescript-language-server` | `npm i -g typescript-language-server typescript` | ~80-150 MB | Most common, well-maintained |
| Python | `pyright` | `npm i -g pyright` | ~100-200 MB | Fast, Microsoft-backed |
| Rust | `rust-analyzer` | `rustup component add rust-analyzer` | ~200-500 MB | Official Rust LSP |
| HTML/CSS | `vscode-langservers-extracted` | `npm i -g vscode-langservers-extracted` | ~50-80 MB | Includes HTML, CSS, JSON |
| JSON | `vscode-langservers-extracted` | (same as above) | (shared) | JSON Schema validation |
| Markdown | `marksman` | Binary download | ~30 MB | Links, references |

### Recommended Initial Set
- **Phase 1**: TypeScript only (most users, good test case)
- **Phase 2**: Add Python (second most popular)
- **Phase 3**: Add Rust (native to VoiDesk)
- **Phase 4**: Add HTML/CSS/JSON (web development)

---

## 3. Implementation Phases

### Phase 1: TypeScript LSP (2-3 weeks)

**Goal**: Full TypeScript/JavaScript support with all core features

**Week 1: Infrastructure**
- [ ] Create `src-tauri/src/lsp/` module structure
- [ ] Implement LSP process spawning with stdin/stdout pipes
- [ ] Implement JSON-RPC message framing (Content-Length headers)
- [ ] Create request/response correlation system
- [ ] Implement `initialize` / `initialized` handshake

**Week 2: Document Sync**
- [ ] Implement `textDocument/didOpen` on file open
- [ ] Implement `textDocument/didChange` with incremental sync
- [ ] Implement `textDocument/didSave` on save
- [ ] Implement `textDocument/didClose` on tab close
- [ ] Add debouncing for `didChange` (300ms)

**Week 3: Features**
- [ ] Implement `textDocument/completion` (autocomplete)
- [ ] Implement `textDocument/hover` (type info on hover)
- [ ] Implement `textDocument/definition` (go-to-definition)
- [ ] Implement `textDocument/publishDiagnostics` (error squiggles)
- [ ] Create CodeMirror extensions for each feature

### Phase 2: Python LSP (1 week)

**Goal**: Add Python support using Pyright

- [ ] Add Pyright process management
- [ ] Reuse existing LSP infrastructure
- [ ] Test with Python projects
- [ ] Handle Python-specific diagnostics

### Phase 3: Rust LSP (1 week)

**Goal**: Add Rust support using rust-analyzer

- [ ] Add rust-analyzer process management
- [ ] Handle Cargo workspace detection
- [ ] Test with Rust projects
- [ ] Handle rust-analyzer specific extensions

### Phase 4: Web Languages (1 week)

**Goal**: Add HTML, CSS, JSON support

- [ ] Add vscode-langservers-extracted
- [ ] Configure for HTML, CSS, JSON
- [ ] Test embedded languages (CSS in HTML, etc.)

---

## 4. Technical Approach

### 4.1 Rust Backend Structure

```
src-tauri/src/
├── lsp/
│   ├── mod.rs              # Module exports
│   ├── manager.rs          # LSP process lifecycle management
│   ├── transport.rs        # JSON-RPC over stdio
│   ├── protocol.rs         # LSP message types (serde)
│   ├── document.rs         # Document state tracking
│   └── servers/
│       ├── mod.rs
│       ├── typescript.rs   # TS-specific configuration
│       ├── python.rs       # Python-specific configuration
│       └── rust.rs         # Rust-specific configuration
```

### 4.2 JSON-RPC Communication

LSP uses JSON-RPC 2.0 over stdin/stdout with Content-Length headers:

```
Content-Length: 123\r\n
\r\n
{"jsonrpc":"2.0","id":1,"method":"textDocument/hover","params":{...}}
```

**Rust Implementation Pattern:**

```rust
use std::process::{Command, Stdio, Child};
use std::io::{BufReader, BufWriter, Write, BufRead};
use serde::{Serialize, Deserialize};
use serde_json::Value;

pub struct LspTransport {
    child: Child,
    writer: BufWriter<std::process::ChildStdin>,
    reader: BufReader<std::process::ChildStdout>,
    next_id: u64,
}

impl LspTransport {
    pub fn spawn(command: &str, args: &[&str]) -> Result<Self, String> {
        let mut child = Command::new(command)
            .args(args)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| e.to_string())?;

        let stdin = child.stdin.take().unwrap();
        let stdout = child.stdout.take().unwrap();

        Ok(Self {
            child,
            writer: BufWriter::new(stdin),
            reader: BufReader::new(stdout),
            next_id: 1,
        })
    }

    pub fn send_request(&mut self, method: &str, params: Value) -> Result<u64, String> {
        let id = self.next_id;
        self.next_id += 1;

        let request = serde_json::json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": params
        });

        let content = serde_json::to_string(&request).unwrap();
        let header = format!("Content-Length: {}\r\n\r\n", content.len());

        self.writer.write_all(header.as_bytes()).map_err(|e| e.to_string())?;
        self.writer.write_all(content.as_bytes()).map_err(|e| e.to_string())?;
        self.writer.flush().map_err(|e| e.to_string())?;

        Ok(id)
    }
}
```

### 4.3 Tauri Commands

```rust
// src-tauri/src/commands/lsp_commands.rs

#[tauri::command]
pub async fn lsp_initialize(root_path: String) -> Result<(), String> {
    // Start language servers for detected languages in project
}

#[tauri::command]
pub async fn lsp_shutdown() -> Result<(), String> {
    // Gracefully shutdown all language servers
}

#[tauri::command]
pub async fn lsp_did_open(path: String, content: String, language: String) -> Result<(), String> {
    // Notify language server that document was opened
}

#[tauri::command]
pub async fn lsp_did_change(path: String, content: String) -> Result<(), String> {
    // Send incremental document changes
}

#[tauri::command]
pub async fn lsp_completion(
    path: String,
    line: u32,
    character: u32,
) -> Result<Vec<CompletionItem>, String> {
    // Request completions at position
}

#[tauri::command]
pub async fn lsp_hover(
    path: String,
    line: u32,
    character: u32,
) -> Result<Option<HoverInfo>, String> {
    // Request hover information
}

#[tauri::command]
pub async fn lsp_goto_definition(
    path: String,
    line: u32,
    character: u32,
) -> Result<Option<Location>, String> {
    // Request definition location
}
```

### 4.4 CodeMirror Extensions

**Autocomplete Extension:**

```typescript
import { autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { invoke } from "@tauri-apps/api/core";

async function lspCompletionSource(context: CompletionContext): Promise<CompletionResult | null> {
    const pos = context.pos;
    const line = context.state.doc.lineAt(pos);

    const completions = await invoke<CompletionItem[]>("lsp_completion", {
        path: currentFilePath,
        line: line.number - 1,  // LSP uses 0-based lines
        character: pos - line.from,
    });

    return {
        from: context.pos,
        options: completions.map(item => ({
            label: item.label,
            type: item.kind,
            detail: item.detail,
            apply: item.insertText || item.label,
        })),
    };
}

export const lspAutocomplete = autocompletion({
    override: [lspCompletionSource],
    activateOnTyping: true,
});
```

**Hover Extension:**

```typescript
import { hoverTooltip, Tooltip } from "@codemirror/view";
import { invoke } from "@tauri-apps/api/core";

export const lspHover = hoverTooltip(async (view, pos) => {
    const line = view.state.doc.lineAt(pos);

    const hover = await invoke<HoverInfo | null>("lsp_hover", {
        path: currentFilePath,
        line: line.number - 1,
        character: pos - line.from,
    });

    if (!hover) return null;

    return {
        pos,
        create: () => {
            const dom = document.createElement("div");
            dom.className = "lsp-hover-tooltip";
            dom.innerHTML = hover.contents;
            return { dom };
        },
    };
});
```

**Diagnostics Extension:**

```typescript
import { Diagnostic, linter } from "@codemirror/lint";
import { listen } from "@tauri-apps/api/event";

// Listen for diagnostics from backend
listen<DiagnosticEvent>("lsp-diagnostics", (event) => {
    const { path, diagnostics } = event.payload;
    // Update editor diagnostics
});

export const lspDiagnostics = linter(async (view) => {
    // Return cached diagnostics for current file
    return cachedDiagnostics.map(d => ({
        from: d.range.start,
        to: d.range.end,
        severity: d.severity,
        message: d.message,
    }));
});
```

---

## 5. State Management

### 5.1 Document State Tracking

The LSP manager must track:
- **Open documents**: URI → content mapping
- **Document versions**: Incremented on each change
- **Pending requests**: ID → callback mapping

```rust
use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::RwLock;

pub struct DocumentState {
    pub uri: String,
    pub language_id: String,
    pub version: i32,
    pub content: String,
}

pub struct LspState {
    documents: HashMap<String, DocumentState>,
    pending_requests: HashMap<u64, oneshot::Sender<Value>>,
}

pub type SharedLspState = Arc<RwLock<LspState>>;
```

### 5.2 Frontend State (Zustand)

```typescript
interface LspState {
    // Server status
    servers: Map<string, ServerStatus>;

    // Diagnostics per file
    diagnostics: Map<string, Diagnostic[]>;

    // Actions
    setDiagnostics: (path: string, diagnostics: Diagnostic[]) => void;
    clearDiagnostics: (path: string) => void;
}
```

---

## 6. Performance Considerations

### 6.1 Memory Usage

| Server | Idle RAM | Active RAM | Notes |
|--------|----------|------------|-------|
| typescript-language-server | 80-150 MB | 200-400 MB | Scales with project size |
| pyright | 100-200 MB | 300-600 MB | Type checking is memory-intensive |
| rust-analyzer | 200-500 MB | 500 MB - 2 GB | Cargo workspace size matters |

**Total for all 3**: 400 MB - 1.5 GB (idle) to 1-3 GB (active)

### 6.2 Mitigation Strategies

1. **Lazy Loading**: Only start a language server when a file of that type is opened
   ```rust
   pub async fn ensure_server_running(language: &str) -> Result<(), String> {
       if !is_server_running(language) {
           start_server(language).await?;
       }
       Ok(())
   }
   ```

2. **Idle Shutdown**: Stop servers after 10 minutes of inactivity
   ```rust
   tokio::spawn(async move {
       loop {
           tokio::time::sleep(Duration::from_secs(60)).await;
           for (lang, last_activity) in server_activity.iter() {
               if last_activity.elapsed() > Duration::from_secs(600) {
                   shutdown_server(lang).await;
               }
           }
       }
   });
   ```

3. **Request Debouncing**: Debounce `didChange` notifications (300ms)

4. **Completion Caching**: Cache recent completions for fast re-display

5. **Single Server Per Language**: Never spawn duplicate servers

### 6.3 Comparison to VS Code

| Aspect | VS Code | VoiDesk (Planned) |
|--------|---------|-------------------|
| Base Memory | ~300-500 MB | ~100-150 MB (Tauri) |
| LSP Overhead | Same servers | Same servers |
| Extension Host | Separate process (~100 MB) | None (native) |
| Total (3 LSPs) | 1-2 GB typical | 500 MB - 1.5 GB |

**Key Insight**: The language servers are the same, so memory usage will be similar. VoiDesk saves memory on the editor itself (Tauri vs Electron), but LSP memory is unavoidable.

---

## 7. Estimated Timeline

| Phase | Duration | Deliverable |
|-------|----------|-------------|
| **Phase 1: TypeScript** | 2-3 weeks | Full TS/JS support |
| **Phase 2: Python** | 1 week | Pyright integration |
| **Phase 3: Rust** | 1 week | rust-analyzer integration |
| **Phase 4: Web** | 1 week | HTML/CSS/JSON support |
| **Phase 5: Polish** | 1 week | Performance tuning, edge cases |

**Total: 6-8 weeks** for full LSP support across major languages

---

## 8. Dependencies to Add

### Rust (Cargo.toml)
```toml
# For JSON-RPC
serde_json = "1"

# For async process management
tokio = { version = "1", features = ["process", "io-util", "sync"] }

# For LSP types (optional, can define manually)
lsp-types = "0.94"
```

### npm (package.json)
```json
{
  "@codemirror/autocomplete": "^6.x",
  "@codemirror/lint": "^6.x",
  "@codemirror/tooltip": "^6.x"
}
```

---

## 9. Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Language server not installed | Feature won't work | Show helpful error with install instructions |
| Server crashes | Loss of features | Auto-restart with exponential backoff |
| High memory usage | System slowdown | Implement idle shutdown, warn user |
| Slow completions | Poor UX | Add loading indicator, cache results |
| Cross-platform paths | Bugs on Windows | Use `url` crate for URI handling |

---

## 10. Success Criteria

- [ ] TypeScript autocomplete works with < 200ms latency
- [ ] Hover shows type information correctly
- [ ] Go-to-definition navigates to correct location
- [ ] Diagnostics appear within 500ms of typing
- [ ] Memory usage stays under 1 GB with 2 servers running
- [ ] Servers shut down cleanly on app exit

