import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { SearchAddon } from "@xterm/addon-search";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTerminalStore } from "@/stores/terminalStore";

interface TerminalPaneProps {
    paneId: string;
    isActive: boolean;
    onFocus: () => void;
}

export function TerminalPane({ paneId, isActive, onFocus }: TerminalPaneProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const pidRef = useRef<number | null>(null);

    useEffect(() => {
        if (!containerRef.current) return;

        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: "var(--font-mono)",
            theme: {
                background: "#0d0d14",
                foreground: "#e0e0eb",
                cursor: "#6366f1",
                selectionBackground: "rgba(99, 102, 241, 0.3)",
                black: "#0a0a0f",
                red: "#ef4444",
                green: "#10b981",
                yellow: "#f59e0b",
                blue: "#6366f1",
                magenta: "#8b5cf6",
                cyan: "#06b6d4",
                white: "#f5f5fa",
            },
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.loadAddon(new SearchAddon());

        term.open(containerRef.current);
        setTimeout(() => fitAddon.fit(), 0);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        term.onData((data: string) => {
            if (pidRef.current !== null) {
                invoke("write_to_pty", { pid: pidRef.current, data });
            }
        });

        let resizeTimeout: ReturnType<typeof setTimeout> | null = null;
        const resizeObserver = new ResizeObserver(() => {
            if (resizeTimeout) clearTimeout(resizeTimeout);
            resizeTimeout = setTimeout(() => {
                fitAddon.fit();
                if (pidRef.current !== null) {
                    const dims = fitAddon.proposeDimensions();
                    if (dims) {
                        invoke("resize_pty", {
                            pid: pidRef.current,
                            cols: dims.cols,
                            rows: dims.rows,
                        });
                    }
                }
            }, 50);
        });
        resizeObserver.observe(containerRef.current);

        let unlistenOutput: (() => void) | null = null;
        let unlistenExit: (() => void) | null = null;

        const initializePty = async () => {
            try {
                const dims = fitAddon.proposeDimensions();
                const result = await invoke<{ pid: number }>("create_pty", {
                    cols: dims?.cols || 80,
                    rows: dims?.rows || 24,
                });

                pidRef.current = result.pid;
                useTerminalStore.getState().setPanePid(paneId, result.pid);

                unlistenOutput = await listen<{ pid: number; data: string }>("pty-output", (event) => {
                    if (event.payload.pid === pidRef.current) {
                        term.write(event.payload.data);
                    }
                });

                unlistenExit = await listen<{ pid: number }>("pty-exit", (event) => {
                    if (event.payload.pid === pidRef.current) {
                        term.write("\r\n\x1b[33m[Process Completed]\x1b[0m\r\n");
                    }
                });
            } catch (error) {
                console.error("Terminal pane error:", error);
                term.write("\r\n\x1b[31m[System Error] Failed to initialize PTY engine.\x1b[0m\r\n");
            }
        };

        initializePty();

        return () => {
            resizeObserver.disconnect();
            if (resizeTimeout) clearTimeout(resizeTimeout);
            unlistenOutput?.();
            unlistenExit?.();
            if (pidRef.current !== null) {
                invoke("close_pty", { pid: pidRef.current });
                useTerminalStore.getState().setPanePid(paneId, null);
            }
            term.dispose();
            xtermRef.current = null;
            fitAddonRef.current = null;
            pidRef.current = null;
        };
    }, [paneId]);

    useEffect(() => {
        if (isActive && fitAddonRef.current) {
            setTimeout(() => fitAddonRef.current?.fit(), 0);
        }
    }, [isActive]);

    return (
        <div
            className={`h-full w-full bg-[#0d0d14] p-2 ${
                isActive
                    ? "border border-[#6366f1]/40"
                    : "border border-transparent"
            }`}
            onClick={onFocus}
            onFocus={onFocus}
        >
            <div ref={containerRef} className="h-full w-full" />
        </div>
    );
}
