Typescript/react code:
```
import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';

interface TerminalProps {
  onClose?: () => void;
  initialCommand?: string;
}

export const TerminalComponent = ({ onClose, initialCommand }: TerminalProps) => {
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const pidRef = useRef<number | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    // Initialize terminal
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1e1e1e',
        foreground: '#d4d4d4',
        cursor: '#ffffff',
        cursorAccent: '#000000',
        selectionBackground: '#264f78',
        black: '#000000',
        red: '#cd3131',
        green: '#0dbc79',
        yellow: '#e5e510',
        blue: '#2472c8',
        magenta: '#bc3fbc',
        cyan: '#11a8cd',
        white: '#e5e5e5',
        brightBlack: '#666666',
        brightRed: '#f14c4c',
        brightGreen: '#23d18b',
        brightYellow: '#f5f543',
        brightBlue: '#3b8eea',
        brightMagenta: '#d670d6',
        brightCyan: '#29b8db',
        brightWhite: '#e5e5e5',
      },
      scrollback: 10000,
      allowTransparency: false,
    });

    // Add addons
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    const searchAddon = new SearchAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.loadAddon(searchAddon);

    term.open(terminalRef.current);
    fitAddon.fit();

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // Initialize PTY through Tauri backend
    initializePty(term);

    // Handle terminal input
    term.onData((data) => {
      if (pidRef.current) {
        invoke('write_to_pty', { pid: pidRef.current, data });
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (pidRef.current) {
        const dims = fitAddon.proposeDimensions();
        if (dims) {
          invoke('resize_pty', {
            pid: pidRef.current,
            cols: dims.cols,
            rows: dims.rows,
          });
        }
      }
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      if (pidRef.current) {
        invoke('close_pty', { pid: pidRef.current });
      }
      term.dispose();
    };
  }, []);

  const initializePty = async (term: Terminal) => {
    try {
      const dims = fitAddonRef.current?.proposeDimensions();
      const result = await invoke<{ pid: number }>('create_pty', {
        cols: dims?.cols || 80,
        rows: dims?.rows || 24,
        shell: null, // Use default shell
      });

      pidRef.current = result.pid;

      // Listen for PTY output
      const unlisten = await listen<{ pid: number; data: string }>(
        'pty-output',
        (event) => {
          if (event.payload.pid === pidRef.current) {
            term.write(event.payload.data);
          }
        }
      );

      // Run initial command if provided
      if (initialCommand) {
        setTimeout(() => {
          invoke('write_to_pty', {
            pid: pidRef.current,
            data: initialCommand + '\n',
          });
        }, 100);
      }
    } catch (error) {
      console.error('Failed to create PTY:', error);
      term.write('Failed to start terminal\r\n');
    }
  };

  return (
    <div className="terminal-container" style={{ height: '100%', width: '100%' }}>
      <div ref={terminalRef} style={{ height: '100%', width: '100%' }} />
    </div>
  );
};



```

Tauri PTY Backend(rust):
```
// src-tauri/src/terminal.rs

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Manager, State};

#[derive(Serialize, Deserialize)]
pub struct PtyInfo {
    pub pid: u32,
}

pub struct TerminalState {
    ptys: Arc<Mutex<HashMap<u32, Arc<Mutex<Box<dyn portable_pty::MasterPty + Send>>>>>>,
    next_id: Arc<Mutex<u32>>,
}

impl TerminalState {
    pub fn new() -> Self {
        Self {
            ptys: Arc::new(Mutex::new(HashMap::new())),
            next_id: Arc::new(Mutex::new(0)),
        }
    }
}

#[tauri::command]
pub async fn create_pty(
    state: State<'_, TerminalState>,
    app: AppHandle,
    cols: u16,
    rows: u16,
    shell: Option<String>,
) -> Result<PtyInfo, String> {
    let pty_system = native_pty_system();

    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(size)
        .map_err(|e| format!("Failed to open PTY: {}", e))?;

    // Determine shell
    let shell_cmd = if let Some(s) = shell {
        s
    } else {
        #[cfg(target_os = "windows")]
        {
            std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string())
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string())
        }
    };

    let mut cmd = CommandBuilder::new(shell_cmd);
    cmd.cwd(std::env::current_dir().unwrap_or_default());

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    // Generate PID
    let pid = {
        let mut next_id = state.next_id.lock().unwrap();
        let id = *next_id;
        *next_id += 1;
        id
    };

    let master = Arc::new(Mutex::new(pair.master));

    // Store PTY
    state
        .ptys
        .lock()
        .unwrap()
        .insert(pid, Arc::clone(&master));

    // Spawn reader thread
    let app_clone = app.clone();
    let master_clone = Arc::clone(&master);
    std::thread::spawn(move || {
        let mut reader = master_clone.lock().unwrap().try_clone_reader().unwrap();
        let mut buf = [0u8; 8192];

        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    let _ = app_clone.emit_all(
                        "pty-output",
                        serde_json::json!({
                            "pid": pid,
                            "data": data
                        }),
                    );
                }
                Err(e) => {
                    eprintln!("PTY read error: {}", e);
                    break;
                }
            }
        }

        // Clean up on exit
        let _ = app_clone.emit_all(
            "pty-exit",
            serde_json::json!({
                "pid": pid
            }),
        );
    });

    Ok(PtyInfo { pid })
}

#[tauri::command]
pub async fn write_to_pty(
    state: State<'_, TerminalState>,
    pid: u32,
    data: String,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(master) = ptys.get(&pid) {
        let mut master = master.lock().unwrap();
        let mut writer = master.take_writer().map_err(|e| e.to_string())?;
        writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Write failed: {}", e))?;
        writer.flush().map_err(|e| format!("Flush failed: {}", e))?;
        Ok(())
    } else {
        Err("PTY not found".to_string())
    }
}

#[tauri::command]
pub async fn resize_pty(
    state: State<'_, TerminalState>,
    pid: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let ptys = state.ptys.lock().unwrap();
    if let Some(master) = ptys.get(&pid) {
        let master = master.lock().unwrap();
        let size = PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        };
        master
            .resize(size)
            .map_err(|e| format!("Resize failed: {}", e))?;
        Ok(())
    } else {
        Err("PTY not found".to_string())
    }
}

#[tauri::command]
pub async fn close_pty(state: State<'_, TerminalState>, pid: u32) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    ptys.remove(&pid);
    Ok(())
}

// Add to your main.rs:
/*
mod terminal;

fn main() {
    tauri::Builder::default()
        .manage(terminal::TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            terminal::create_pty,
            terminal::write_to_pty,
            terminal::resize_pty,
            terminal::close_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
*/
```

GUIDE:
# Terminal Setup Guide

## 1. Install Frontend Dependencies

```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-web-links @xterm/addon-search
```

## 2. Add Rust Dependencies

Add to your `src-tauri/Cargo.toml`:

```toml
[dependencies]
portable-pty = "0.8"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
tauri = { version = "1.5", features = ["shell-open"] }
```

## 3. Configure Tauri Permissions

In `src-tauri/tauri.conf.json`, ensure you have:

```json
{
  "tauri": {
    "allowlist": {
      "all": false,
      "shell": {
        "all": false,
        "execute": false,
        "open": true
      }
    }
  }
}
```

## 4. Update main.rs

```rust
mod terminal;

fn main() {
    tauri::Builder::default()
        .manage(terminal::TerminalState::new())
        .invoke_handler(tauri::generate_handler![
            terminal::create_pty,
            terminal::write_to_pty,
            terminal::resize_pty,
            terminal::close_pty,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
```

## 5. Customization Options

### Change Terminal Theme

```typescript
const customTheme = {
  background: '#282c34',
  foreground: '#abb2bf',
  cursor: '#528bff',
  black: '#1e2127',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#d19a66',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#abb2bf',
  // ... bright colors
};
```

### Add Custom Key Bindings

```typescript
term.onKey(({ key, domEvent }) => {
  // Ctrl+C
  if (domEvent.ctrlKey && domEvent.key === 'c') {
    // Handle copy
  }
  // Ctrl+V
  if (domEvent.ctrlKey && domEvent.key === 'v') {
    // Handle paste
  }
});
```

### Font Customization

```typescript
const term = new Terminal({
  fontFamily: '"Fira Code", "Cascadia Code", Menlo, monospace',
  fontSize: 14,
  fontWeight: 'normal',
  fontWeightBold: 'bold',
  lineHeight: 1.2,
  letterSpacing: 0,
});
```

### Add More Addons

```bash
npm install @xterm/addon-unicode11 @xterm/addon-serialize
```

```typescript
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { SerializeAddon } from '@xterm/addon-serialize';

const unicode11Addon = new Unicode11Addon();
term.loadAddon(unicode11Addon);
term.unicode.activeVersion = '11';
```

## 6. Usage Example

```tsx
import { TerminalComponent } from './TerminalComponent';

function App() {
  return (
    <div style={{ height: '100vh' }}>
      <TerminalComponent 
        initialCommand="echo 'Hello from terminal!'"
        onClose={() => console.log('Terminal closed')}
      />
    </div>
  );
}
```

## 7. Advanced Features

### Split Terminal Support

Create a terminal manager to handle multiple terminals:

```typescript
const [terminals, setTerminals] = useState<number[]>([]);

const addTerminal = () => {
  setTerminals([...terminals, Date.now()]);
};

const removeTerminal = (id: number) => {
  setTerminals(terminals.filter(t => t !== id));
};
```

### Terminal Tabs

Combine with a tab component for VS Code-like experience.

### Context Menu

Add right-click menu for copy/paste:

```typescript
terminalRef.current.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  // Show custom context menu
});
```

## Common Issues

**Windows**: Make sure PowerShell or cmd.exe is in PATH
**Linux/Mac**: Ensure proper shell environment variables
**Permissions**: PTY operations may need elevated permissions on some systems