# OpenDesk - High-Performance AI IDE

## Core Technologies

| Layer | Technology | Why |
|-------|-----------|-----|
| **Frontend Framework** | React 18 + TypeScript | Excellent ecosystem, great DX |
| **UI Components** | Tailwind CSS + shadcn/ui | Modern, performant, accessible |
| **Desktop Runtime** | Tauri 2.0 (Rust) | ~10x smaller than Electron, native performance |
| **Editor Engine** | CodeMirror 6 | Lightweight, fast, extensible, virtual rendering |
| **AI Backend** | adk-rust (Rust) | Agentic, provider-agnostic, modular, OpenRouter compatible |
| **State Management** | Zustand | Minimal, fast, no boilerplate |
| **LSP Integration** | rust-analyzer + language servers | VSCode-grade intelligence |

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

## Why CodeMirror 6?

| Feature | CodeMirror 6 | Monaco |
|---------|-------------|--------|
| Bundle Size | ~150KB gzipped | ~2.5MB gzipped |
| Performance | GPU-accelerated rendering | Good but heavier |
| TypeScript | First-class support | Built by Microsoft |
| React Integration | Excellent | Requires wrapper |
| Customization | Plugin-based architecture | Complex customization |
| **Perfect for**: Fast, lightweight IDE | ✓ | ✗ |

## Project Structure

```
opendesk/
├── src/
│   ├── components/
│   │   ├── editor/
│   │   │   ├── CodeEditor.tsx         # CodeMirror wrapper
│   │   │   ├── EditorTabs.tsx         # Tab management
│   │   │   ├── Minimap.tsx            # Code minimap
│   │   │   └── syntax/                # Syntax themes
│   │   ├── file-tree/
│   │   │   ├── FileTree.tsx           # Virtualized file tree
│   │   │   ├── FileItem.tsx           # Individual file/folder
│   │   │   └── ContextMenu.tsx        # Right-click context menu
│   │   ├── ai/
│   │   │   ├── AIChat.tsx             # Chat interface
│   │   │   ├── InlineCompletion.tsx   # Ghost text completions
│   │   │   └── AIQuickActions.tsx     # Quick AI commands
│   │   ├── layout/
│   │   │   ├── MainLayout.tsx         # App layout
│   │   │   ├── Sidebar.tsx            # Left sidebar
│   │   │   └── StatusBar.tsx          # Bottom status bar
│   │   └── common/
│   │       ├── Button.tsx             # shadcn-style button
│   │       ├── Input.tsx              # shadcn-style input
│   │       ├── Dialog.tsx             # shadcn-style dialog
│   │       └── ScrollArea.tsx         # Virtualized scroll
│   ├── services/
│   │   ├── lsp/
│   │   │   ├── LanguageServer.ts      # LSP client wrapper
│   │   │   ├── DiagnosticsManager.ts  # Error/warning display
│   │   │   └── completions.ts         # Completion providers
│   │   ├── ai/
│   │   │   ├── AIService.ts           # adk-rust command wrapper
│   │   │   ├── ContextProvider.ts     # AI context extraction
│   │   │   └── StreamingManager.ts    # Stream and event handling
│   │   └── file/
│   │       ├── FileWatcher.ts         # File system watcher
│   │       └── RecentFiles.ts         # MRU file tracking
│   ├── stores/
│   │   ├── editorStore.ts             # Editor state
│   │   ├── fileStore.ts               # Open files, current file
│   │   ├── aiStore.ts                 # AI chat history, settings
│   │   └── uiStore.ts                 # UI state, theme, layout
│   ├── hooks/
│   │   ├── useKeyboard.ts             # Global shortcuts
│   │   ├── useEditor.ts               # Editor instance
│   │   ├── useAI.ts                   # AI operations
│   │   └── useFileSystem.ts           # File operations
│   ├── utils/
│   │   ├── debounce.ts                # Performance utilities
│   │   ├── languageDetection.ts       # Auto-detect language
│   │   └── performanceMonitor.ts      # FPS, memory tracking
│   ├── App.tsx
│   └── main.tsx
├── src-tauri/
│   ├── src/
│   │   ├── commands/
│   │   │   ├── file_commands.rs       # File read/write/delete
│   │   │   ├── project_commands.rs    # Project discovery
│   │   │   ├── search_commands.rs     # Fast project search
│   │   │   └── ai_commands.rs         # AI operations via adk-rust
│   │   ├── services/
│   │   │   ├── file_indexer.rs        # Project file indexing
│   │   │   ├── ai_service.rs          # adk-rust integration
│   │   │   └── lsp_bridge.rs          # LSP communication
│   │   ├── models/
│   │   │   └── mod.rs
│   │   └── main.rs
│   ├── Cargo.toml
│   └── tauri.conf.json
├── components.json                    # shadcn configuration
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── README.md
```

## Development Phases

### Phase 1: Foundation
**Goal**: Working editor with file management

1. **Initialize project**
   ```bash
   npm create tauri-app@latest opendesk -- --template react-ts
   cd opendesk
   npm install
   ```

2. **Install dependencies**
   ```bash
   # UI
   npm install tailwindcss @tailwindcss/vite class-variance-authority clsx tailwind-merge lucide-react
   npm install @radix-ui/react-dialog @radix-ui/react-dropdown-menu @radix-ui/react-scroll-area
   
   # Editor
   npm install @codemirror/view @codemirror/state @codemirror/language @codemirror/commands
   npm install @codemirror/lang-javascript @codemirror/lang-python @codemirror/lang-rust
   npm install @codemirror/theme-one-dark
   
   # State & utilities
   npm install zustand immer
   npm install @tanstack/react-query # For AI requests
   ```

3. **Core components**
   - [ ] File tree with virtualization
   - [ ] CodeMirror 6 editor setup
   - [ ] Tab management system
   - [ ] Theme switching (dark/light)

4. **Rust backend**
   - [ ] File read/write commands
   - [ ] Project directory scanning
   - [ ] File watching (tauri::api::path::watch)

**Deliverable**: Functional editor that can open/edit files locally

### Phase 2: LSP Integration
**Goal**: VSCode-like intelligence

1. **LSP Setup**
   - Install language servers:
     - rust-analyzer (Rust)
     - pyright (Python)  
     - ts-ls (TypeScript)
   - Create LSP bridge in Rust

2. **Features**
   - [ ] Autocompletion
   - [ ] Go to definition
   - [ ] Find references
   - [ ] Error highlighting (diagnostics)
   - [ ] Document symbols
   - [ ] Hover information

3. **CodeMirror extensions**
   - [ ] LSP integration plugin
   - [ ] Diagnostic gutters
   - [ ] Symbol navigation

**Deliverable**: Intelligent editing with language awareness

### ADK-Rust Setup (Rust)
210: 
211: ```toml
212: # src-tauri/Cargo.toml
213: [dependencies]
214: adk-agent = "0.2"
215: adk-core = "0.2"
216: adk-model = { version = "0.2", features = ["openai"] }
217: adk-tool = "0.2"
218: adk-runner = "0.2"
219: adk-session = "0.2"
220: ```

2. **AI Services**
   - [ ] OpenAI provider with custom base URL
   - [ ] Streaming responses (chunked decoding)
   - [ ] Context manager (open files, cursor position)
   - [ ] Tool system (file operations, search)

3. **AI Features**
   - [ ] **Chat panel**: Side-by-side AI conversation
   - [ ] **Inline completions**: Ghost text suggestions
   - [ ] **Code generation**: Generate from comments
   - [ ] **Refactoring**: AI-powered code improvements
   - [ ] **Explain code**: Contextual explanations

4. **Performance optimizations**
   - [ ] Debounced requests (300ms)
   - [ ] Response streaming (immediate feedback)
   - [ ] Context caching
   - [ ] Request cancellation on new keystrokes

**Deliverable**: Fully functional AI coding assistant

### Phase 4: Polish & Performance
**Goal**: Production-ready, blazing fast

1. **Performance tuning**
   - [ ] Virtualize file tree (render only visible items)
   - [ ] Lazy load non-critical components
   - [ ] Web workers for heavy operations
   - [ ] IndexedDB caching for project structure
   - [ ] Memory-efficient LSP communication

2. **User experience**
   - [ ] Keyboard shortcuts system (customizable)
   - [ ] Command palette (Ctrl+Shift+P)
   - [ ] Settings panel
   - [ ] Theme customization
   - [ ] Welcome screen

3. **Testing & optimization**
   - [ ] Performance profiling (Chrome DevTools)
   - [ ] Memory leak detection
   - [ ] Bundle size optimization
   - [ ] Startup time optimization

**Deliverable**: Production-ready, fast IDE

## Key Performance Strategies

### For "Blazing Fast" Performance:

1. **Startup Time**
   - Lazy load CodeMirror language packs
   - Defer non-critical React components
   - Rust backend for file system operations
   - Incremental project loading

2. **Editor Responsiveness**
   - CodeMirror 6's incremental parsing
   - Virtualized viewport (only render visible lines)
   - Web workers for syntax highlighting
   - Debounced LSP updates

3. **AI Perceived Speed**
   - Stream responses character-by-character
   - Show completions immediately with ghost text
   - Cache recent AI context
   - Cancel stale requests automatically

4. **Memory Efficiency**
   - LRU cache for file contents
   - Clean up unused LSP connections
   - Dispose of unused event listeners
   - Use Rust's zero-cost abstractions

## Code Examples

### AI Service (Rust + aisdk)

```rust
// src-tauri/src/services/ai_service.rs

use aisdk::{
    core::{LanguageModelRequest, LanguageModelResult},
    providers::openai::OpenAI,
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct AIRequest {
    pub prompt: String,
    pub context: Vec<String>,
    pub stream: bool,
}

#[derive(Serialize, Deserialize)]
pub struct AIResponse {
    pub text: String,
    pub tokens_used: u32,
}

pub struct AIService {
    client: OpenAI,
}

impl AIService {
    pub fn new(base_url: String, api_key: String) -> Self {
        let client = OpenAI::builder()
            .base_url(base_url)
            .api_key(api_key)
            .build();
        
        Self { client }
    }

    pub async fn generate(&self, request: AIRequest) -> Result<AIResponse, String> {
        let context = request.context.join("\n\n");
        let full_prompt = format!("Context:\n{}\n\nQuestion:\n{}", context, request.prompt);
        
        let result = LanguageModelRequest::builder()
            .model(self.client.model("gpt-4"))
            .prompt(&full_prompt)
            .build()
            .generate_text()
            .await
            .map_err(|e| e.to_string())?;
        
        Ok(AIResponse {
            text: result.text().to_string(),
            tokens_used: result.usage().unwrap_or_default().total_tokens,
        })
    }

    pub async fn stream_generate(&self, request: AIRequest) -> impl Stream<Item = String> {
        let context = request.context.join("\n\n");
        let full_prompt = format!("Context:\n{}\n\nQuestion:\n{}", context, request.prompt);
        
        let stream = LanguageModelRequest::builder()
            .model(self.client.model("gpt-4"))
            .prompt(&full_prompt)
            .build()
            .stream_text()
            .await
            .unwrap();
        
        stream.map(|chunk| chunk.to_string())
    }
}
```

### CodeMirror Editor Component

```tsx
// src/components/editor/CodeEditor.tsx

import { useEffect, useRef, useCallback } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { defaultHighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { autocompletion, closeBrackets } from '@codemirror/autocomplete';
import { lsp } from '@codemirror/lsp';
import { oneDark } from '@codemirror/theme-one-dark';
import { useFileStore } from '../../stores/fileStore';
import { useKeyboard } from '../../hooks/useKeyboard';

export function CodeEditor() {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView>();
    const { currentFile, updateFileContent } = useFileStore();
    const { registerShortcuts } = useKeyboard();

    // Initialize editor
    useEffect(() => {
        if (!editorRef.current) return;

        const state = EditorState.create({
            doc: currentFile?.content || '',
            extensions: [
                lineNumbers(),
                highlightActiveLine(),
                history(),
                closeBrackets(),
                autocompletion(),
                syntaxHighlighting(defaultHighlightStyle),
                oneDark,
                keymap.of([...defaultKeymap, ...historyKeymap]),
                EditorView.updateListener.of((update) => {
                    if (update.docChanged) {
                        const content = update.state.doc.toString();
                        updateFileContent(currentFile!.path, content);
                    }
                }),
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            view.destroy();
        };
    }, []);

    // Handle file changes
    useEffect(() => {
        if (!viewRef.current || !currentFile) return;
        
        const currentContent = viewRef.current.state.doc.toString();
        if (currentContent !== currentFile.content) {
            viewRef.current.dispatch({
                changes: {
                    from: 0,
                    to: currentContent.length,
                    insert: currentFile.content,
                },
            });
        }
    }, [currentFile?.path]);

    return <div ref={editorRef} className="h-full w-full" />;
}
```

### AI Chat Component

```tsx
// src/components/ai/AIChat.tsx

import { useState, useRef, useEffect } from 'react';
import { useStore } from '../../stores/aiStore';
import { useFileStore } from '../../stores/fileStore';
import { ScrollArea } from '../common/ScrollArea';
import { Send, Loader2 } from 'lucide-react';

export function AIChat() {
    const [input, setInput] = useState('');
    const { messages, isLoading, sendMessage, streamingContent } = useStore();
    const { currentFile, openFiles } = useFileStore();
    const scrollRef = useRef<HTMLDivElement>(null);
    const abortRef = useRef<AbortController>();

    const context = [
        `Current file: ${currentFile?.path}`,
        `Open files: ${openFiles.map(f => f.path).join(', ')}`,
        currentFile?.content ? `File content:\n${currentFile.content.slice(0, 2000)}` : '',
    ].filter(Boolean);

    const handleSend = async () => {
        if (!input.trim() || isLoading) return;
        
        abortRef.current?.abort();
        abortRef.current = new AbortController();
        
        await sendMessage(input, context, abortRef.current.signal);
        setInput('');
    };

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages, streamingContent]);

    return (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-4">
                <ScrollArea ref={scrollRef} className="h-full">
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            className={`mb-4 ${
                                msg.role === 'user' ? 'text-right' : 'text-left'
                            }`}
                        >
                            <div
                                className={`inline-block max-w-[80%] rounded-lg px-4 py-2 ${
                                    msg.role === 'user'
                                        ? 'bg-primary text-primary-foreground'
                                        : 'bg-muted'
                                }`}
                            >
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    {streamingContent && (
                        <div className="text-left">
                            <div className="inline-block bg-muted rounded-lg px-4 py-2">
                                {streamingContent}
                                <span className="animate-pulse">█</span>
                            </div>
                        </div>
                    )}
                </ScrollArea>
            </div>
            
            <div className="p-4 border-t">
                <div className="flex gap-2">
                    <input
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && handleSend()}
                        placeholder="Ask AI..."
                        className="flex-1 input"
                    />
                    <button
                        onClick={handleSend}
                        disabled={isLoading}
                        className="btn-primary"
                    >
                        {isLoading ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                        ) : (
                            <Send className="w-4 h-4" />
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
}
```


