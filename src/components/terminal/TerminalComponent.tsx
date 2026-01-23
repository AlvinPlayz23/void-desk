import { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

interface TerminalProps {
    onClose?: () => void;
    initialCommand?: string;
}

export const TerminalComponent = ({ initialCommand }: TerminalProps) => {
    const terminalRef = useRef<HTMLDivElement>(null);
    const xtermRef = useRef<Terminal | null>(null);
    const fitAddonRef = useRef<FitAddon | null>(null);
    const pidRef = useRef<number | null>(null);

    useEffect(() => {
        if (!terminalRef.current) return;

        // Initialize terminal with Obsidian theme
        const term = new Terminal({
            cursorBlink: true,
            fontSize: 13,
            fontFamily: 'var(--font-mono)',
            theme: {
                background: '#0d0d14', // --color-void-850
                foreground: '#e0e0eb', // --color-void-100
                cursor: '#6366f1',    // --color-accent-primary
                selectionBackground: 'rgba(99, 102, 241, 0.3)',
                black: '#0a0a0f',
                red: '#ef4444',
                green: '#10b981',
                yellow: '#f59e0b',
                blue: '#6366f1',
                magenta: '#8b5cf6',
                cyan: '#06b6d4',
                white: '#f5f5fa',
            },
            allowTransparency: true,
        });

        const fitAddon = new FitAddon();
        term.loadAddon(fitAddon);
        term.loadAddon(new WebLinksAddon());
        term.loadAddon(new SearchAddon());

        term.open(terminalRef.current);

        // Defer fit to ensure container is ready
        setTimeout(() => fitAddon.fit(), 0);

        xtermRef.current = term;
        fitAddonRef.current = fitAddon;

        initializePty(term);

        // Terminal -> PTY
        term.onData((data: string) => {
            if (pidRef.current !== null) {
                invoke('write_to_pty', { pid: pidRef.current, data });
            }
        });

        const handleResize = () => {
            fitAddon.fit();
            if (pidRef.current !== null) {
                const dims = fitAddon.proposeDimensions();
                if (dims) {
                    invoke('resize_pty', {
                        pid: pidRef.current,
                        cols: dims.cols,
                        rows: dims.rows,
                    });
                }
            }
        };

        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (pidRef.current !== null) {
                invoke('close_pty', { pid: pidRef.current });
            }
            term.dispose();
        };
    }, []);

    const initializePty = async (term: Terminal) => {
        try {
            const dims = fitAddonRef.current?.proposeDimensions();
            const result = await invoke<any>('create_pty', {
                cols: dims?.cols || 80,
                rows: dims?.rows || 24,
            });

            pidRef.current = result.pid;

            // PTY -> Terminal
            const unlistenOutput = await listen<any>('pty-output', (event) => {
                if (event.payload.pid === pidRef.current) {
                    term.write(event.payload.data);
                }
            });

            const unlistenExit = await listen<any>('pty-exit', (event) => {
                if (event.payload.pid === pidRef.current) {
                    term.write('\r\n\x1b[33m[Process Completed]\x1b[0m\r\n');
                }
            });

            if (initialCommand) {
                setTimeout(() => {
                    invoke('write_to_pty', {
                        pid: pidRef.current,
                        data: initialCommand + '\n',
                    });
                }, 200);
            }
            return () => {
                unlistenOutput();
                unlistenExit();
            };
        } catch (error) {
            console.error('Terminal error:', error);
            term.write('\r\n\x1b[31m[System Error] Failed to initialize PTY engine.\x1b[0m\r\n');
        }
    };

    return (
        <div className="h-full w-full bg-[#0d0d14] p-2">
            <div ref={terminalRef} className="h-full w-full" />
        </div>
    );
};
