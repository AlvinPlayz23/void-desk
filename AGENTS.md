# AGENTS.md - VoiDesk AI IDE

## Project Overview

VoiDesk is a high-performance AI IDE built with:
- **Frontend**: React 18 + TypeScript + Vite + Tailwind CSS 4 + Radix UI
- **Desktop Runtime**: Tauri 2.0 (Rust backend)
- **Editor Engine**: CodeMirror 6
- **AI Backend**: adk-rust - using OpenAI-compatible streaming with tool support
- **State Management**: Zustand with persist middleware

---

## Build/Lint/Test Commands

### Frontend (React/TypeScript)
```bash
# Development server (port 1420)
npm run dev

# Type-check and build for production
npm run build

# Preview production build
npm run preview
```

### Tauri (Rust Backend)
```bash
# Development mode (starts both frontend + Tauri)
npm run tauri dev

# Build production app
npm run tauri build

# Run Rust tests (from src-tauri directory)
cd src-tauri && cargo test

# Run single Rust test
cd src-tauri && cargo test test_name

# Check Rust code without building
cd src-tauri && cargo check

# Format Rust code
cd src-tauri && cargo fmt

# Lint Rust code
cd src-tauri && cargo clippy
```

---

## Code Style Guidelines

### TypeScript/React

**Imports Order**:
1. React imports
2. External libraries (@codemirror/*, @radix-ui/*, etc.)
3. Internal absolute imports (@/stores/*, @/components/*, @/hooks/*)
4. Relative imports
5. Types (last)

**Formatting**:
- Use 4-space indentation (matches project config)
- Use double quotes for strings in JSX
- Use arrow functions for components: `export function ComponentName()`
- Prefer `const` over `let`

**Component Structure**:
```tsx
import { useEffect, useRef } from "react";
import { ExternalLib } from "external-lib";
import { useStore } from "@/stores/store";

export function ComponentName() {
    // Refs first
    const ref = useRef<HTMLDivElement>(null);
    
    // Store hooks
    const { data, action } = useStore();
    
    // Effects
    useEffect(() => { /* ... */ }, []);
    
    // Render
    return <div ref={ref}>...</div>;
}
```

**State Management (Zustand with Persistence)**:
```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

interface StoreState {
    value: string;
    setValue: (v: string) => void;
}

export const useStore = create<StoreState>()(
    persist(
        (set) => ({
            value: "",
            setValue: (v) => set({ value: v }),
        }),
        { name: "store-key" }
    )
);
```

**Chat History with Persisted Messages**:
```typescript
import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Message {
    role: "user" | "assistant";
    content: string;
    toolOperations?: ToolOperation[];
    timestamp: number;
}

interface ChatState {
    messages: Message[];
    addMessage: (message: Message) => void;
    clearMessages: () => void;
}

export const useChatStore = create<ChatState>()(
    persist(
        (set) => ({
            messages: [],
            addMessage: (msg) => set((state) => ({
                messages: [...state.messages, msg]
            })),
            clearMessages: () => set({ messages: [] }),
        }),
        { name: "voiddesk-chat-history" }
    )
);
```

**Path Aliases**: Use `@/` for src directory imports (configured in tsconfig.json)

**Context Menu Pattern**:
```tsx
// Fixed position context menu with click-outside-to-close
const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
const menuRef = useRef<HTMLDivElement>(null);

useEffect(() => {
    const handleClick = (e: MouseEvent) => {
        if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
            setContextMenu(null);
        }
    };
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
}, []);

return (
    <>
        <div onContextMenu={(e) => { e.preventDefault(); setContextMenu({ x: e.clientX, y: e.clientY }); }}>
            {/* content */}
        </div>
        {contextMenu && (
            <div ref={menuRef} style={{ left: contextMenu.x, top: contextMenu.y }} className="context-menu">
                {/* menu items */}
            </div>
        )}
    </>
);
```

### Rust (Tauri Backend)

**Module Structure**:
```
src-tauri/src/
├── main.rs          # Entry point (just calls lib::run())
├── lib.rs           # Tauri builder, plugin registration, command handlers
└── commands/
    ├── mod.rs       # Module exports
    ├── file_commands.rs
    ├── project_commands.rs
    ├── ai_commands.rs    # Tauri commands for AI streaming
    ├── ai_service.rs     # adk-rust agent, runner, session management
    └── ai_tools.rs       # FunctionTools for file ops, commands
```

**Tauri Commands**:
```rust
#[tauri::command]
pub async fn command_name(
    arg1: String,
    arg2: Option<u32>,
) -> Result<ReturnType, String> {
    // Use .map_err(|e| e.to_string()) for error conversion
    do_something().map_err(|e| e.to_string())
}
```

**Cross-platform File Explorer**:
```rust
#[tauri::command]
pub async fn reveal_in_file_explorer(path: String) -> Result<(), String> {
    // Windows: explorer /select, path
    // macOS: open -R path
    // Linux: xdg-open parent(path)
}
```

**Error Handling**: Always return `Result<T, String>` from Tauri commands

**Streaming with Channels**:
```rust
use tauri::ipc::Channel;

#[tauri::command]
pub async fn stream_command(
    on_event: Channel<EventType>,
) -> Result<(), String> {
    on_event.send(EventType { ... }).map_err(|e| e.to_string())?;
    Ok(())
}
```

---

## adk-rust Integration Guide

### Dependencies (Cargo.toml)
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
```

### OpenAI-Compatible Provider (OpenRouter)
```rust
use adk_model::openai::OpenAIClient;

// For OpenRouter or any OpenAI-compatible API
// The compatible method takes 3 arguments: api_key, api_base, model_id
let model = OpenAIClient::compatible(api_key, &api_base, model_id)?;
```

### Agent with Tools Pattern
```rust
use adk_agent::LlmAgentBuilder;
use adk_tool::FunctionTool;
use adk_core::ToolContext;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize, JsonSchema)]
struct ToolArgs {
    /// Argument description (becomes schema description)
    arg_name: String,
}

async fn tool_fn(_ctx: Arc<dyn ToolContext>, args: Value) -> Result<Value, adk_core::AdkError> {
    let args: ToolArgs = serde_json::from_value(args)
        .map_err(|e| adk_core::AdkError::Tool(format!("Invalid args: {}", e)))?;
    Ok(json!({ "result": "success" }))
}

let tool = FunctionTool::new("tool_name", "Tool description", tool_fn)
    .with_parameters_schema::<ToolArgs>();

let agent = LlmAgentBuilder::new("agent_name")
    .instruction("System prompt here")
    .model(Arc::new(model))
    .tool(Arc::new(tool))
    .build()?;
```

### Streaming Response
```rust
use adk_runner::{Runner, RunnerConfig};
use adk_session::{CreateRequest, InMemorySessionService, SessionService};
use adk_core::Content;
use futures::StreamExt;

let session_service = Arc::new(InMemorySessionService::new());
let session = session_service.create(CreateRequest {
    app_name: "app".to_string(),
    user_id: "user".to_string(),
    session_id: None,
    state: std::collections::HashMap::new(),
}).await?;

let runner = Runner::new(RunnerConfig {
    app_name: "app".to_string(),
    agent: Arc::new(agent),
    session_service,
    artifact_service: None,
    memory_service: None,
    run_config: None,
})?;

let content = Content::new("user").with_text("Hello!");
let mut stream = runner.run("user".to_string(), session.id().to_string(), content).await?;

while let Some(event) = stream.next().await {
    if let Ok(e) = event {
        if let Some(content) = e.llm_response.content {
            for part in content.parts {
                if let adk_core::Part::Text { text } = part {
                    // Send text chunk to frontend
                }
            }
        }
    }
}
```

---

## Project Structure

```
void-desk/
├── src/                          # React frontend
│   ├── components/
│   │   ├── editor/               # CodeMirror editor
│   │   ├── file-tree/            # File explorer
│   │   │   ├── FileTree.tsx      # Recursive file tree
│   │   │   └── FileItem.tsx      # Individual item with context menu
│   │   ├── ai/                   # AI chat panel
│   │   │   └── AIChat.tsx        # Chat interface with tool call display
│   │   ├── layout/               # App layout (MainLayout, Sidebar, StatusBar)
│   │   └── ui/                   # Shared UI (modals, buttons)
│   ├── stores/                   # Zustand stores
│   │   ├── fileStore.ts          # File tree state, open files
│   │   ├── chatStore.ts          # Chat history with persist middleware
│   │   ├── settingsStore.ts      # API settings (persisted)
│   │   └── uiStore.ts            # UI state
│   ├── hooks/                    # React hooks
│   │   ├── useFileSystem.ts      # File operations with auto-refresh
│   │   └── useAI.ts              # AI chat with streaming
│   └── App.tsx
├── src-tauri/                    # Rust backend
│   ├── src/
│   │   ├── lib.rs                # Tauri setup, command registration
│   │   └── commands/             # Tauri commands
│   │       ├── mod.rs
│   │       ├── file_commands.rs  # File ops + reveal_in_file_explorer
│   │       ├── project_commands.rs
│   │       ├── ai_commands.rs    # AI streaming
│   │       ├── ai_service.rs     # adk-rust agent, runner, session
│   │       └── ai_tools.rs       # FunctionTools
│   ├── Cargo.toml
│   └── tauri.conf.json
├── adk-rust-docs-examples/       # Reference examples for adk-rust
│   └── examples/                 # Many examples: openai_*, streaming_*, etc.
├── plan.md                       # Architecture and implementation plan
└── note.md                       # adk-rust integration notes
```

---

## Current Implementation Status

**Completed**:
- File tree with open folder functionality
- CodeMirror 6 editor with syntax highlighting
- Tab management for open files
- New file/folder creation
- Settings modal for API configuration
- Command palette (Ctrl+Shift+P)
- Keyboard shortcuts
- **Right-click Context Menu**: Copy path, reveal in explorer, delete
- **Real-time File Tree**: Auto-refreshes after file operations (create, delete)
- **Drag and Drop**: File movement within the file tree (including root drop zone)
- **Terminal Integration**: High-fidelity xterm.js terminal with PTY support (portable-pty 0.10)
- **adk-rust Integration**:
  - AI chat with streaming via adk-rust Runner
  - Session management for conversation history
  - FunctionTools for file operations (read, write, list)
  - FunctionTools for command execution (run_command)
  - OpenRouter/OpenAI-compatible provider support
- **Chat History Persistence**: Messages saved to localStorage via Zustand persist middleware
- **Context Injection**: @ mentions to attach file content to messages (Sent content now readable by AI)
- **Live Explorer**: Auto-refresh file tree when files are modified externally (uses `notify` crate)
- **Enhanced AI UI**: Rich Markdown, Context Pills, and Tool HUD
- **LSP Integration (Phase 1)**:
  - Autocomplete via `textDocument/completion` with CodeMirror integration
  - Hover tooltips via `textDocument/hover` with markdown rendering
  - TypeScript/JavaScript support via `typescript-language-server`
  - Proper Windows URI handling (`file:///C:/path` format)
  - Request/response routing with oneshot channels (no response stealing)
  - Server request handling (`workspace/configuration`, etc.)

**Next Steps**:
1. Implement LSP Diagnostics (error squiggles, Problems panel) - Phase 2
2. Add Go-To-Definition and Find References
3. Add global search across project (powered by ripgrep)
4. Implement inline AI completions (ghost text)
5. Add git integration (status, diffs)

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    Tauri 2.0 Window                     │
│  ┌───────────────────────────────────────────────────┐  │
│  │              React Frontend (Vite)                │  │
│  │  ┌──────────┐  ┌──────────────┐  ┌─────────────┐ │  │
│  │  │ File     │  │ CodeMirror 6 │  │ AI Panel    │ │  │
│  │  │ Tree     │  │ Editor       │  │ (Chat/Chat) │ │  │
│  │  │          │  │              │  │             │ │  │
│  │  └──────────┘  └──────────────┘  └─────────────┘ │  │
│  └───────────────────────────────────────────────────┘  │
│                         ▲                                │
│         Tauri Commands (Rust FFI)                        │
│                         ▼                                │
│  ┌───────────────────────────────────────────────────┐  │
│  │              Rust Backend                         │  │
│  │  ┌──────────────┐  ┌──────────────────────────┐  │  │
│  │  │ File System  │  │ AI Service (adk-rust)      │  │  │
│  │  │ Operations   │  │ • OpenRouter/Compatible     │  │  │
│  │  │              │  │ • Modular Agent Interface   │  │  │
│  │  │              │  │ • Tool/Function Calling     │  │  │
│  │  └──────────────┘  └──────────────────────────┘  │  │
│  │  ┌──────────────┐  ┌──────────────────────────┐  │  │
│  │  │ LSP Bridge   │  │ Context Manager          │  │  │
│  │    │  │  │ (language • Open Files Index       │  │  │
│  │  │  servers)    │  │ • Project Structure      │  │  │
│  │  └──────────────┘  └──────────────────────────┘  │  │
│  └───────────────────────────────────────────────────┘  │
│                         ▲                                │
│              System APIs (OS Level)                      │
└─────────────────────────────────────────────────────────┘
```

## Key Files to Reference

| File | Purpose |
|------|---------|
| `README.md` | General overview and project screenshots |
| `plan.md` | Full architecture and implementation roadmap |
| `src/stores/chatStore.ts` | Chat history persistence with Zustand |
| `src/components/file-tree/FileItem.tsx` | File item with right-click context menu |
| `src/hooks/useFileSystem.ts` | File operations with auto-refresh |
| `src/components/ai/AIChat.tsx` | AI chat with enhanced tool call UI |
| `src-tauri/src/commands/ai_commands.rs` | Current AI streaming implementation |
| `src-tauri/src/commands/file_commands.rs` | File operations + reveal_in_file_explorer |

---

## Important Notes

1. **OpenRouter Compatibility**: adk-rust supports custom base URLs via `OpenAIClient::compatible(key, base, model)`
2. **Streaming**: Use `runner.run()` which returns a stream, iterate with `stream.next().await`
3. **Tool Schema**: Derive `JsonSchema` for tool args, use `/// doc comments` for parameter descriptions
4. **Session Required**: Always create a session before running the agent
5. **Tauri Channels**: For streaming to frontend, use `Channel<T>` in command signature
6. **Auto-refresh Pattern**: After file operations, call `refreshFileTree(rootPath)` to update the UI
7. **Context Menu**: Always prevent default and use fixed positioning for right-click menus
