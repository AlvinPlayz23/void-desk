# VoiDesk Future Optimizations

This document outlines optimization strategies for syntax highlighting and LSP implementation in VoiDesk.

---

## 1. Syntax Highlighting Optimization

### Current State Analysis

The current implementation imports all language packages at startup:

```typescript
// Current approach - all languages imported at top
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
```

| Aspect | Current | Optimal |
|--------|---------|---------|
| Bundle size | All 7 languages (~50-80 KB gzipped) | Only load what's needed |
| Runtime | `useMemo` prevents recalculation ✅ | Good |
| Initial load | All languages parsed at startup | Lazy load on demand |

### Recommended: Dynamic Imports with Caching

```typescript
// src/components/editor/languageLoader.ts

import { Extension } from "@codemirror/state";

// Lazy-loaded language modules
const languageLoaders: Record<string, () => Promise<Extension>> = {
    javascript: async () => {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ jsx: true, typescript: false });
    },
    typescript: async () => {
        const { javascript } = await import("@codemirror/lang-javascript");
        return javascript({ jsx: true, typescript: true });
    },
    python: async () => {
        const { python } = await import("@codemirror/lang-python");
        return python();
    },
    rust: async () => {
        const { rust } = await import("@codemirror/lang-rust");
        return rust();
    },
    html: async () => {
        const { html } = await import("@codemirror/lang-html");
        return html();
    },
    css: async () => {
        const { css } = await import("@codemirror/lang-css");
        return css();
    },
    json: async () => {
        const { json } = await import("@codemirror/lang-json");
        return json();
    },
    markdown: async () => {
        const { markdown } = await import("@codemirror/lang-markdown");
        return markdown();
    },
};

// Cache loaded extensions to avoid re-importing
const loadedExtensions = new Map<string, Extension>();

function detectLanguage(filePath: string): string | null {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
        js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
        ts: "typescript", tsx: "typescript",
        py: "python", pyw: "python", pyi: "python",
        rs: "rust",
        html: "html", htm: "html", xhtml: "html",
        css: "css", scss: "css", sass: "css", less: "css",
        json: "json", jsonc: "json",
        md: "markdown", markdown: "markdown", mdx: "markdown",
    };
    return langMap[ext] || null;
}

export async function getLanguageExtensionAsync(filePath: string): Promise<Extension> {
    const lang = detectLanguage(filePath);
    
    if (!lang || !languageLoaders[lang]) {
        return []; // Plain text
    }
    
    // Return cached if available
    if (loadedExtensions.has(lang)) {
        return loadedExtensions.get(lang)!;
    }
    
    // Load and cache
    const extension = await languageLoaders[lang]();
    loadedExtensions.set(lang, extension);
    return extension;
}
```

### Component Usage

```typescript
// src/components/editor/CodeEditor.tsx

import { useState, useEffect } from "react";
import { Extension } from "@codemirror/state";
import { getLanguageExtensionAsync } from "./languageLoader";

export function CodeEditor() {
    const [languageExtension, setLanguageExtension] = useState<Extension>([]);
    const { currentFile } = useFileStore();
    
    useEffect(() => {
        if (currentFile?.path) {
            getLanguageExtensionAsync(currentFile.path)
                .then(setLanguageExtension);
        } else {
            setLanguageExtension([]);
        }
    }, [currentFile?.path]);
    
    // Use languageExtension in CodeMirror extensions array
    // ...
}
```

### Impact

| Optimization | Impact | Effort |
|--------------|--------|--------|
| Dynamic imports | -30-50 KB initial bundle | Medium |
| Extension caching | Faster subsequent opens | Low |
| Preload common languages (TS/JS) | Better UX | Low |

---

## 2. rust-analyzer Optimization

### When is rust-analyzer Needed?

| User Activity | rust-analyzer Needed? | TypeScript LSP Needed? |
|---------------|----------------------|------------------------|
| Editing `.tsx`, `.ts`, `.css` files | ❌ No | ✅ Yes |
| Editing `.rs` files in `src-tauri/` | ✅ Yes | ❌ No |
| Editing both frontend and backend | ✅ Yes | ✅ Yes |
| Just browsing code | ❌ No | ❌ No |

### Activity-Based Lifecycle Management

```rust
// src-tauri/src/lsp/lifecycle.rs

use std::time::{Duration, Instant};
use tokio::sync::RwLock;

pub struct ServerLifecycle {
    last_activity: RwLock<Instant>,
    idle_timeout: Duration,
    is_running: RwLock<bool>,
}

impl ServerLifecycle {
    pub fn new(idle_timeout_minutes: u64) -> Self {
        Self {
            last_activity: RwLock::new(Instant::now()),
            idle_timeout: Duration::from_secs(idle_timeout_minutes * 60),
            is_running: RwLock::new(false),
        }
    }
    
    pub async fn record_activity(&self) {
        *self.last_activity.write().await = Instant::now();
    }
    
    pub async fn should_shutdown(&self) -> bool {
        let last = *self.last_activity.read().await;
        last.elapsed() > self.idle_timeout
    }
}

// Different timeouts per server based on resource usage
pub fn get_idle_timeout(server_type: &str) -> Duration {
    match server_type {
        "rust-analyzer" => Duration::from_secs(5 * 60),   // 5 minutes (aggressive)
        "typescript" => Duration::from_secs(15 * 60),     // 15 minutes (lenient)
        "pyright" => Duration::from_secs(10 * 60),        // 10 minutes
        _ => Duration::from_secs(10 * 60),
    }
}
```

### Frontend Language Tracking

```typescript
// src/hooks/useLspLifecycle.ts

import { invoke } from "@tauri-apps/api/core";

const activeLanguages = new Set<string>();

function detectLanguage(path: string): string | null {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const langMap: Record<string, string> = {
        ts: "typescript", tsx: "typescript", js: "typescript", jsx: "typescript",
        py: "python",
        rs: "rust",
    };
    return langMap[ext] || null;
}

export function onFileOpen(path: string, openFiles: string[]) {
    const lang = detectLanguage(path);
    if (lang) {
        activeLanguages.add(lang);
        invoke("lsp_ensure_server", { language: lang });
    }
}

export function onFileClose(path: string, openFiles: string[]) {
    const lang = detectLanguage(path);
    if (!lang) return;

    // Check if any other open files use this language
    const stillNeeded = openFiles.some(f => detectLanguage(f) === lang);
    if (!stillNeeded) {
        activeLanguages.delete(lang);
        // Server will auto-shutdown after idle timeout
    }
}
```

### rust-analyzer Configuration (Memory Reduction)

Pass these settings to reduce memory by 150-300 MB:

```rust
// When initializing rust-analyzer
let init_params = serde_json::json!({
    "initializationOptions": {
        "cargo": {
            "buildScripts": { "enable": false },  // Saves ~100-200 MB
            "features": []                         // Only analyze default features
        },
        "procMacro": { "enable": false },          // Saves ~50-100 MB
        "checkOnSave": { "enable": false },        // Reduces CPU spikes
        "files": {
            "excludeDirs": ["target", "node_modules", ".git"]
        },
        "lru": {
            "capacity": 64                         // Reduce LRU cache size
        }
    }
});
```

| Setting | Memory Saved | Trade-off |
|---------|--------------|-----------|
| `buildScripts.enable: false` | 100-200 MB | No build script expansion |
| `procMacro.enable: false` | 50-100 MB | No proc macro expansion |
| `checkOnSave.enable: false` | Reduces spikes | No automatic `cargo check` |
| Exclude `target/` | 50-100 MB | Already default |

---

## 3. Priority-Based Resource Allocation

### Server Priority System

```rust
// src-tauri/src/lsp/priority.rs

use std::time::Duration;

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum ServerPriority {
    Critical,   // TypeScript - always keep running
    Normal,     // Python - moderate timeout
    Background, // Rust - aggressive shutdown
}

impl ServerPriority {
    pub fn idle_timeout(&self) -> Duration {
        match self {
            Self::Critical => Duration::from_secs(30 * 60),   // 30 min
            Self::Normal => Duration::from_secs(10 * 60),     // 10 min
            Self::Background => Duration::from_secs(3 * 60),  // 3 min
        }
    }

    pub fn max_memory_mb(&self) -> usize {
        match self {
            Self::Critical => 512,
            Self::Normal => 384,
            Self::Background => 256,
        }
    }
}

pub fn get_priority(language: &str, project_type: &str) -> ServerPriority {
    match (language, project_type) {
        ("typescript", _) => ServerPriority::Critical,  // VoiDesk is TS-heavy
        ("rust", "tauri") => ServerPriority::Normal,    // Needed but not constant
        ("python", _) => ServerPriority::Normal,
        _ => ServerPriority::Background,
    }
}
```

### Memory Pressure Response

```rust
// src-tauri/src/lsp/memory.rs

use std::collections::HashMap;

pub struct LspServer {
    pub name: String,
    pub priority: ServerPriority,
    // ... other fields
}

impl LspServer {
    pub async fn shutdown(&mut self) {
        // Graceful shutdown logic
    }
}

#[cfg(target_os = "windows")]
fn get_available_memory_mb() -> usize {
    // Use Windows API to get available memory
    // Placeholder - implement with windows-sys crate
    8000
}

#[cfg(target_os = "linux")]
fn get_available_memory_mb() -> usize {
    // Read from /proc/meminfo
    8000
}

#[cfg(target_os = "macos")]
fn get_available_memory_mb() -> usize {
    // Use sysctl
    8000
}

pub async fn handle_memory_pressure(servers: &mut HashMap<String, LspServer>) {
    let available_mb = get_available_memory_mb();

    if available_mb < 1000 {
        // Shutdown background servers first
        for (_name, server) in servers.iter_mut() {
            if server.priority == ServerPriority::Background {
                server.shutdown().await;
            }
        }
    }

    if available_mb < 500 {
        // Shutdown normal priority servers
        for (_name, server) in servers.iter_mut() {
            if server.priority == ServerPriority::Normal {
                server.shutdown().await;
            }
        }
    }
}
```

---

## 4. Request Coalescing

Batch multiple hover/completion requests to reduce server load by ~30%:

```rust
// src-tauri/src/lsp/coalescer.rs

use std::collections::HashMap;
use tokio::time::{sleep, Duration};
use tokio::sync::Mutex;

pub struct PendingRequest {
    pub path: String,
    pub line: u32,
    pub character: u32,
    pub request_type: String,
}

pub struct RequestCoalescer {
    pending: Mutex<HashMap<String, Vec<PendingRequest>>>,
    debounce_ms: u64,
}

impl RequestCoalescer {
    pub fn new(debounce_ms: u64) -> Self {
        Self {
            pending: Mutex::new(HashMap::new()),
            debounce_ms,
        }
    }

    pub async fn add_request(&self, key: String, request: PendingRequest) {
        {
            let mut pending = self.pending.lock().await;
            pending.entry(key.clone()).or_default().push(request);
        }

        // Wait for more requests
        sleep(Duration::from_millis(self.debounce_ms)).await;

        // Process only the latest request for each key
        let mut pending = self.pending.lock().await;
        if let Some(requests) = pending.remove(&key) {
            if let Some(latest) = requests.last() {
                self.execute(latest).await;
            }
        }
    }

    async fn execute(&self, request: &PendingRequest) {
        // Execute the LSP request
        // ...
    }
}
```

---

## 5. Tiered LSP Support

### Recommended Tiers for VoiDesk

```typescript
// src/config/lspTiers.ts

export const lspTiers = {
    // Tier 1: Full LSP (always available)
    full: ["typescript", "javascript"],

    // Tier 2: On-demand LSP (lazy loaded, aggressive shutdown)
    onDemand: ["python", "rust"],

    // Tier 3: Syntax only (no LSP - just highlighting)
    syntaxOnly: ["html", "css", "json", "markdown"],
};

export function shouldStartLsp(language: string): boolean {
    return lspTiers.full.includes(language) || lspTiers.onDemand.includes(language);
}

export function getLspMode(language: string): "full" | "onDemand" | "syntaxOnly" {
    if (lspTiers.full.includes(language)) return "full";
    if (lspTiers.onDemand.includes(language)) return "onDemand";
    return "syntaxOnly";
}
```

### Language Server Alternatives

| Language | Full LSP | Lightweight Alternative | Trade-off |
|----------|----------|------------------------|-----------|
| TypeScript | typescript-language-server (150 MB) | None recommended | Essential |
| Python | pyright (200 MB) | pylsp (100 MB) | Less accurate |
| Rust | rust-analyzer (500 MB+) | None viable | Only option |
| HTML/CSS | vscode-langservers (80 MB) | emmet-ls (30 MB) | Less features |
| JSON | vscode-json-languageserver (50 MB) | Syntax only | Sufficient |
| Markdown | marksman (30 MB) | Syntax only | Sufficient |

---

## 6. Additional Optimizations

### Completion Caching

```typescript
// src/hooks/useCompletionCache.ts

interface CachedCompletion {
    items: CompletionItem[];
    timestamp: number;
    prefix: string;
}

const completionCache = new Map<string, CachedCompletion>();
const CACHE_TTL_MS = 5000; // 5 seconds

export async function getCachedCompletions(
    path: string,
    line: number,
    character: number,
    prefix: string
): Promise<CompletionItem[] | null> {
    const key = `${path}:${line}`;
    const cached = completionCache.get(key);

    if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
        // Filter cached items by new prefix
        if (prefix.startsWith(cached.prefix)) {
            return cached.items.filter(item =>
                item.label.toLowerCase().startsWith(prefix.toLowerCase())
            );
        }
    }

    return null; // Cache miss
}

export function setCachedCompletions(
    path: string,
    line: number,
    prefix: string,
    items: CompletionItem[]
) {
    const key = `${path}:${line}`;
    completionCache.set(key, {
        items,
        timestamp: Date.now(),
        prefix,
    });
}
```

### Diagnostic Throttling

```typescript
// src/hooks/useDiagnosticThrottle.ts

import { useRef, useCallback } from "react";

export function useDiagnosticThrottle(onDiagnostics: (d: Diagnostic[]) => void, ms = 500) {
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);
    const latestDiagnostics = useRef<Diagnostic[]>([]);

    const throttledUpdate = useCallback((diagnostics: Diagnostic[]) => {
        latestDiagnostics.current = diagnostics;

        if (timeoutRef.current) return; // Already scheduled

        timeoutRef.current = setTimeout(() => {
            onDiagnostics(latestDiagnostics.current);
            timeoutRef.current = null;
        }, ms);
    }, [onDiagnostics, ms]);

    return throttledUpdate;
}
```

### Incremental Indexing Cache

```rust
// src-tauri/src/lsp/cache.rs

use std::path::Path;

/// Paths that should be excluded from file watching to preserve LSP caches
pub fn should_ignore_for_cache(path: &Path) -> bool {
    let ignore_patterns = [
        "target/rust-analyzer",  // rust-analyzer cache
        ".pyright",              // pyright cache
        "node_modules/.cache",   // TypeScript cache
        ".git",
    ];

    let path_str = path.to_string_lossy();
    ignore_patterns.iter().any(|p| path_str.contains(p))
}

/// Workspace folders to index per language (reduces indexing time)
pub fn get_workspace_folders(language: &str, project_root: &str) -> Vec<String> {
    match language {
        "rust" => vec![format!("{}/src-tauri", project_root)],
        "typescript" => vec![format!("{}/src", project_root)],
        _ => vec![project_root.to_string()],
    }
}
```

---

## Summary: Quick Wins for VoiDesk

| Optimization | Impact | Priority |
|--------------|--------|----------|
| Dynamic imports for language packages | -30-50 KB bundle | High |
| Lazy-load rust-analyzer | Saves 300 MB+ until needed | High |
| 5-minute idle timeout for rust-analyzer | Reclaims memory when not editing Rust | High |
| Disable proc macros in rust-analyzer | -50-100 MB | Medium |
| Skip LSP for HTML/CSS/JSON/Markdown | Avoid 80+ MB per server | Medium |
| Request coalescing | -30% server load | Medium |
| Completion caching | Faster repeated triggers | Low |
| Priority-based allocation | Better resource management | Low |

---

## Implementation Order

1. **Phase 1**: Dynamic imports for syntax highlighting (quick win)
2. **Phase 2**: Lazy-load rust-analyzer with aggressive timeout
3. **Phase 3**: Tiered LSP support (full/on-demand/syntax-only)
4. **Phase 4**: Request coalescing and caching
5. **Phase 5**: Memory pressure monitoring and response

