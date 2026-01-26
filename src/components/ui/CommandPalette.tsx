import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Search, Command, File, Settings, Moon, PanelLeft, PanelRight } from 'lucide-react';
import Fuse from 'fuse.js';
import { useUIStore } from '@/stores/uiStore';
import { useFileStore, FileNode } from '@/stores/fileStore';
import { useFileSystem } from '@/hooks/useFileSystem';
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

interface CommandItem {
    id: string;
    name: string;
    description?: string;
    icon: React.ReactNode;
    action: () => void;
    shortcut?: string;
}

export function CommandPalette() {
    const {
        isCommandPaletteVisible,
        closeCommandPalette,
        commandPaletteMode,
        toggleSidebar,
        toggleAIPanel,
        toggleTheme,
        openSettingsPage,
        theme
    } = useUIStore();

    const { fileTree, rootPath } = useFileStore();
    const { openFileInEditor } = useFileSystem();

    const [search, setSearch] = useState('');
    const [selectedIndex, setSelectedIndex] = useState(0);
    const scrollRef = useRef<HTMLDivElement>(null);

    // Flatten file tree for file search
    const flattenedFiles = useMemo(() => {
        const files: { path: string; name: string }[] = [];
        const traverse = (nodes: FileNode[]) => {
            nodes.forEach(node => {
                if (!node.isDir) {
                    files.push({ path: node.path, name: node.name });
                }
                if (node.children) {
                    traverse(node.children);
                }
            });
        };
        traverse(fileTree);
        return files;
    }, [fileTree]);

    // Define available commands
    const commands: CommandItem[] = useMemo(() => [
        {
            id: 'open-settings',
            name: 'Settings: Open Settings',
            icon: <Settings className="w-4 h-4" />,
            action: () => openSettingsPage(),
            shortcut: 'Ctrl+,'
        },
        {
            id: 'toggle-sidebar',
            name: 'View: Toggle Sidebar',
            icon: <PanelLeft className="w-4 h-4" />,
            action: toggleSidebar,
            shortcut: 'Ctrl+B'
        },
        {
            id: 'toggle-ai-panel',
            name: 'View: Toggle AI Assistant',
            icon: <PanelRight className="w-4 h-4" />,
            action: toggleAIPanel,
            shortcut: 'Ctrl+Shift+L'
        },
        {
            id: 'toggle-theme',
            name: `View: Switch to ${theme === 'dark' ? 'Light' : 'Dark'} Mode`,
            icon: <Moon className="w-4 h-4" />,
            action: toggleTheme,
        },
        {
            id: 'save-file',
            name: 'File: Save Current File',
            icon: <Settings className="w-4 h-4" />,
            action: () => {
                const currentFile = useFileStore.getState().openFiles.find(f => f.path === useFileStore.getState().currentFilePath);
                if (currentFile) useFileSystem().saveFile(currentFile.path, currentFile.content);
            },
            shortcut: 'Ctrl+S'
        },
        {
            id: 'close-all-tabs',
            name: 'Tabs: Close All Tabs',
            icon: <Settings className="w-4 h-4" />,
            action: () => {
                useFileStore.getState().openFiles.forEach(f => useFileStore.getState().closeFile(f.path));
            },
        },
        {
            id: 'refresh-files',
            name: 'Files: Refresh Explorer',
            icon: <Settings className="w-4 h-4" />,
            action: () => {
                if (rootPath) {
                    useFileSystem().refreshFileTree(rootPath);
                }
            },
        },
    ], [toggleSidebar, toggleAIPanel, toggleTheme, openSettingsPage, theme, rootPath]);

    // Fuzzy search logic
    const items = useMemo(() => {
        if (commandPaletteMode === 'file') {
            if (!search) return flattenedFiles.slice(0, 10).map(f => ({
                id: f.path,
                name: f.name,
                description: f.path,
                icon: <File className="w-4 h-4" />,
                action: () => openFileInEditor(f.path, f.name)
            }));

            const fuse = new Fuse(flattenedFiles, { keys: ['name'] });
            return fuse.search(search).map(result => ({
                id: result.item.path,
                name: result.item.name,
                description: result.item.path,
                icon: <File className="w-4 h-4" />,
                action: () => openFileInEditor(result.item.path, result.item.name)
            }));
        } else {
            if (!search) return commands;

            const fuse = new Fuse(commands, { keys: ['name'] });
            return fuse.search(search).map(result => result.item);
        }
    }, [commandPaletteMode, search, flattenedFiles, commands, openFileInEditor]);

    // Reset selection on search change
    useEffect(() => {
        setSelectedIndex(0);
    }, [search]);

    // Handle keyboard navigation
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setSelectedIndex(prev => (prev + 1) % items.length);
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setSelectedIndex(prev => (prev - 1 + items.length) % items.length);
        } else if (e.key === 'Enter') {
            e.preventDefault();
            const selected = items[selectedIndex];
            if (selected) {
                selected.action();
                closeCommandPalette();
            }
        } else if (e.key === 'Escape') {
            closeCommandPalette();
        }
    };

    // Scroll active item into view
    useEffect(() => {
        const container = scrollRef.current;
        const activeItem = container?.querySelector(`[data-index="${selectedIndex}"]`) as HTMLElement;
        if (container && activeItem) {
            const containerRect = container.getBoundingClientRect();
            const itemRect = activeItem.getBoundingClientRect();

            if (itemRect.bottom > containerRect.bottom) {
                activeItem.scrollIntoView({ block: 'end' });
            } else if (itemRect.top < containerRect.top) {
                activeItem.scrollIntoView({ block: 'start' });
            }
        }
    }, [selectedIndex]);

    return (
        <Dialog.Root open={isCommandPaletteVisible} onOpenChange={(open) => !open && closeCommandPalette()}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/40 backdrop-blur-[2px] z-[100] animate-fade-in" />
                <Dialog.Content
                    className="fixed top-[20%] left-1/2 -translate-x-1/2 w-full max-w-[600px] bg-[var(--color-void-900)] border border-[var(--color-border-subtle)] rounded-xl shadow-2xl z-[101] overflow-hidden animate-slide-up"
                    onKeyDown={handleKeyDown}
                >
                    <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-void-800)]/50">
                        {commandPaletteMode === 'command' ? (
                            <Command className="w-4 h-4 text-[var(--color-accent-primary)]" />
                        ) : (
                            <Search className="w-4 h-4 text-[var(--color-accent-primary)]" />
                        )}
                        <input
                            autoFocus
                            className="flex-1 bg-transparent border-none outline-none text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)]"
                            placeholder={commandPaletteMode === 'command' ? "Search commands..." : "Go to file..."}
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                        />
                        <div className="flex items-center gap-1.5 px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] text-[10px] text-[var(--color-text-muted)] font-mono">
                            ESC
                        </div>
                    </div>

                    <div
                        ref={scrollRef}
                        className="max-h-[400px] overflow-y-auto p-2 space-y-0.5 custom-scrollbar"
                    >
                        {items.length > 0 ? (
                            items.map((item, index) => (
                                <button
                                    key={item.id}
                                    data-index={index}
                                    className={cn(
                                        "w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-all group",
                                        index === selectedIndex
                                            ? "bg-[var(--color-accent-primary)]/15 text-[var(--color-accent-primary)]"
                                            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-void-800)]"
                                    )}
                                    onClick={() => {
                                        item.action();
                                        closeCommandPalette();
                                    }}
                                    onMouseEnter={() => setSelectedIndex(index)}
                                >
                                    <div className="flex items-center gap-3 overflow-hidden">
                                        <span className={cn(
                                            index === selectedIndex
                                                ? "text-[var(--color-accent-primary)]"
                                                : "text-[var(--color-text-muted)] group-hover:text-[var(--color-text-secondary)]"
                                        )}>
                                            {item.icon}
                                        </span>
                                        <div className="flex flex-col overflow-hidden">
                                            <span className="text-sm font-medium truncate">{item.name}</span>
                                            {item.description && (
                                                <span className="text-[11px] opacity-60 truncate font-mono">{item.description}</span>
                                            )}
                                        </div>
                                    </div>
                                    {(item as any).shortcut && (
                                        <div className={cn(
                                            "shrink-0 px-1.5 py-0.5 rounded text-[10px] font-mono border",
                                            index === selectedIndex
                                                ? "border-[var(--color-accent-primary)]/30 bg-[var(--color-accent-primary)]/10"
                                                : "border-[var(--color-border-subtle)] bg-[var(--color-void-950)]/50"
                                        )}>
                                            {(item as any).shortcut}
                                        </div>
                                    )}
                                </button>
                            ))
                        ) : (
                            <div className="py-12 text-center text-[var(--color-text-muted)] flex flex-col items-center gap-3">
                                <Search className="w-8 h-8 opacity-20" />
                                <p className="text-sm">No results found for "{search}"</p>
                            </div>
                        )}
                    </div>

                    <div className="px-4 py-2 border-t border-[var(--color-border-subtle)] bg-[var(--color-void-950)] flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                                <span className="px-1 py-0.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] font-mono">↑↓</span>
                                Navigate
                            </div>
                            <div className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
                                <span className="px-1 py-0.5 rounded border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] font-mono">ENTER</span>
                                Select
                            </div>
                        </div>
                        <div className="text-[10px] text-[var(--color-text-muted)] font-medium uppercase tracking-wider opacity-50">
                            VoiDesk Palette
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
}
