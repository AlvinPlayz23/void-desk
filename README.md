# VoiDesk 🌑

[![Tauri](https://img.shields.io/badge/Runtime-Tauri%202.0-blue?logo=tauri)](https://tauri.app/)
[![React](https://img.shields.io/badge/Frontend-React%2018-61DAFB?logo=react)](https://reactjs.org/)
[![License](https://img.shields.io/badge/License-MIT-green)](LICENSE)

VoiDesk is a **high-performance, AI-native IDE** designed for speed, precision, and a futuristic developer experience. Built on **Tauri 2.0 and Rust**, it offers the power of a native application with the flexibility of a modern web stack.

![VoiDesk Screenshot](screenshot.png)

## 🚀 Why VoiDesk?

VoiDesk is built for developers who find Electron-based editors too heavy. By leveraging Rust and the system's native WebView, VoiDesk achieves **instant startup times** and **minimal RAM usage** without sacrificing the rich UI of a modern IDE.

---

## ✨ Key Features

### 🛠️ Advanced Explorer & File Ops
- **Multi-Select & Batch Operations**: Select multiple files/folders using `Shift+Click` (range) or `Ctrl/Cmd+Toggle`. Move or Delete entire selections in one go.
- **Improved Drag & Drop**: Seamlessly move items between directories or back to the workspace root with visual target indicators.
- **Native Context Menu**: Fast, native-feeling menus for quick actions like Copy Path, Reveal in Explorer, and Rename.
- **Live Watcher**: Your project tree stays in sync with the disk automatically using high-performance system events.

### 🤖 Deep AI Integration (Native Agent)
- **Agentic Capabilities**: The AI isn't just a chat box. It can **read, write, create, and delete files** to help you build features or fix bugs proactively.
- **Ghost Text (Inline Completions)**: Context-aware suggestions appear as you type. Accept with `Tab` or accept word-by-word with `Ctrl/Cmd + Right Arrow`.
- **Tool-Call HUD**: Visual feedback in the chat whenever the AI interacts with your system (reading files, listing directories, etc.).
- **Session Resilience**: Stable, persistent conversation history that re-initializes automatically across app restarts.
- **Context Awareness**: Use `@` to reference specific files or folders in your chat context.

### ⚡ Professional Editor Performance
- **CodeMirror 6 Engine**: A modernized editor core with support for complex extensions and high-performance syntax highlighting.
- **LSP Support**: Robust code intelligence including **Autocomplete** and **Rich Markdown Hover Tooltips**.
- **GPU-Accelerated Terminal**: Integrated `xterm.js` terminal with full PTY support via `portable-pty` for a seamless shell experience.

### 🎨 The Void Aesthetic
- Deep-space dark mode with subtle micro-animations.
- Focus-driven contrast and premium typography (JetBrains Mono).
- Responsive, glassmorphic UI components built with Tailwind CSS 4.

---

## 🛠️ Tech Stack

- **Backend**: Rust, Tauri 2.0, adk-rust (Agent Development Kit)
- **Frontend**: React 18, TypeScript, Tailwind CSS 4, Radix UI, Zustand
- **Editor**: CodeMirror 6
- **Terminal**: xterm.js, portable-pty

---

## 🚀 Getting Started

### Prerequisites
- **Node.js**: v18+
- **Rust**: Latest stable (via rustup)
- **C++ Build Tools**: Required for native dependencies (Windows)

### Installation
1. **Clone & Enter**
   ```bash
   git clone https://github.com/AlvinPlayz23/void-desk.git
   cd void-desk
   ```
2. **Install Deps**
   ```bash
   npm install
   ```
3. **Launch Dev**
   ```bash
   npm run tauri dev
   ```

---

## 🗺️ Roadmap & Documentation

- [x] High-Fidelity Terminal Integration
- [x] Multi-Select & Batch File Operations
- [x] Inline AI Completions (Ghost Text)
- [x] Persistent AI Sessions
- [ ] LSP Diagnostics & Error Squiggles (Phase II)
- [ ] Global Find & Replace (Project-wide)
- [ ] Git Integration Panel

For internal architecture and integration details, see **[AGENTS.md](./AGENTS.md)**.

---

MIT © [AlvinPlayz23](https://github.com/AlvinPlayz23)
