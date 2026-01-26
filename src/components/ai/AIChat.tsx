import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Loader2, Sparkles, Trash2, Settings2, StopCircle, Activity, X, File as FileIcon, Plus, ChevronDown } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "@/hooks/useAI";
import { useUIStore } from "@/stores/uiStore";
import { ToolOperation, useChatStore } from "@/stores/chatStore";
import { useFileStore } from "@/stores/fileStore";

export function AIChat() {
    const { messages, isStreaming, sendMessage, stopStreaming } = useAI();
    const openSettingsPage = useUIStore((state) => state.openSettingsPage);
    const { createSession, deleteSession, switchSession, activeSessionId } = useChatStore();

    const [input, setInput] = useState("");
    const [showFileSearch, setShowFileSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSessions, setShowSessions] = useState(false);
    const [sessions, setSessions] = useState<any[]>([]);
    const { fileTree } = useFileStore();
    const scrollRef = useRef<HTMLDivElement>(null);
    const sessionsRef = useRef<HTMLDivElement>(null);

    // Initialize first session
    useEffect(() => {
        if (!activeSessionId) {
            createSession("New Chat");
        }
    }, []);

    // Load sessions
    useEffect(() => {
        loadSessions();
    }, []);

    const loadSessions = async () => {
        try {
            const list = await invoke<any[]>("list_chat_sessions");
            setSessions(list);
        } catch (error) {
            console.error("Failed to load sessions:", error);
        }
    };

    const handleNewSession = () => {
        const id = createSession("New Chat");
        switchSession(id);
        loadSessions();
        setShowSessions(false);
    };

    const handleDeleteSession = async (id: string) => {
        if (window.confirm("Delete this chat session?")) {
            deleteSession(id);
            try {
                await invoke("delete_chat_session", { session_id: id });
            } catch (error) {
                console.error("Failed to delete session from backend:", error);
            }
            await loadSessions();
        }
    };

    // Close sessions menu when clicking outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) {
                setShowSessions(false);
            }
        };
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, []);

    // Flatten file tree for searching
    const allFiles = useMemo(() => {
        const files: string[] = [];
        const traverse = (nodes: any[]) => {
            nodes.forEach(node => {
                if (!node.isDir) files.push(node.path);
                if (node.children) traverse(node.children);
            });
        };
        traverse(fileTree);
        return files;
    }, [fileTree]);

    const filteredFiles = useMemo(() => {
        if (!searchQuery) return allFiles.slice(0, 10);
        return allFiles.filter(f => f.toLowerCase().includes(searchQuery.toLowerCase())).slice(0, 10);
    }, [allFiles, searchQuery]);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isStreaming) return;
        const text = input;
        setInput("");
        await sendMessage(text);
    };

    const handleStop = () => stopStreaming();
    const clearChat = () => useChatStore.getState().clearCurrentMessages();

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const val = e.target.value;
        setInput(val);

        const atIndex = val.lastIndexOf("@");
        if (atIndex !== -1 && (atIndex === 0 || val[atIndex - 1] === " ")) {
            setShowFileSearch(true);
            setSearchQuery(val.substring(atIndex + 1));
        } else {
            setShowFileSearch(false);
        }
    };

    const handleSelectFile = (path: string) => {
        const atIndex = input.lastIndexOf("@");
        const newVal = input.substring(0, atIndex) + " ";
        setInput(newVal);
        const state = useChatStore.getState();
        state.addContextPath(path);
        setShowFileSearch(false);
    };

    const currentSessionName = useChatStore((state) => state.currentSession()?.name || "Chat");

    return (
        <div className="flex flex-col h-full bg-[var(--color-surface-base)]">
            {/* Header */}
            <div className="panel-header border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] px-3 py-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent-primary)]" />
                    <span className="text-[10px] font-bold uppercase tracking-widest text-[var(--color-text-tertiary)] hidden md:inline">
                        {currentSessionName}
                    </span>
                </div>
                <div className="flex items-center gap-1">
                    <div className="relative" ref={sessionsRef}>
                        <button
                            onClick={() => setShowSessions(!showSessions)}
                            className="icon-btn p-1.5 hover:bg-[var(--color-void-700)] rounded flex items-center gap-1 text-[10px]"
                            title="Sessions"
                        >
                            <ChevronDown className={`w-3.5 h-3.5 opacity-50 transition-transform ${showSessions ? "rotate-180" : ""}`} />
                        </button>
                        {showSessions && (
                            <div className="absolute right-0 top-full mt-2 w-48 max-h-96 overflow-y-auto bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl z-50">
                                <button
                                    onClick={handleNewSession}
                                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)]"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    New Chat
                                </button>
                                {sessions.map(session => (
                                    <button
                                        key={session.id}
                                        onClick={() => { switchSession(session.id); setShowSessions(false); }}
                                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)] group ${activeSessionId === session.id ? "bg-[var(--color-void-700)] text-[var(--color-accent-primary)]" : ""}`}
                                    >
                                        <div className="flex-1 truncate">
                                            <div className="truncate font-medium">{session.name}</div>
                                            <div className="text-[9px] opacity-30">{new Date(session.created_at * 1000).toLocaleDateString()}</div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    {messages.length > 0 && (
                        <button onClick={() => window.confirm("Clear history?") && clearChat()} className="icon-btn p-1.5 hover:bg-[var(--color-void-700)] rounded">
                            <Trash2 className="w-3.5 h-3.5 opacity-50" />
                        </button>
                    )}
                    <button onClick={() => openSettingsPage("ai")} className="icon-btn p-1.5 hover:bg-[var(--color-void-700)] rounded" title="AI Settings">
                        <Settings2 className="w-3.5 h-3.5 opacity-50" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-6">
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center opacity-20">
                        <Sparkles className="w-12 h-12 mb-4" />
                        <p className="text-sm uppercase tracking-[0.2em] font-bold">Awaiting Input</p>
                    </div>
                ) : (
                    messages.map((msg, idx) => (
                        <div key={idx} className={`flex flex-col ${msg.role === "user" ? "items-end" : "items-start"} gap-3`}>
                            <div className={`max-w-[92%] rounded-xl px-4 py-3 text-[13px] leading-relaxed relative ${msg.role === "user"
                                ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] shadow-[0_4px_20px_rgba(99,102,241,0.2)]"
                                : "bg-[var(--color-surface-overlay)] border border-[var(--color-border-subtle)] text-[var(--color-text-primary)]"
                                }`}>
                                {msg.toolOperations && <ToolOperationDisplay operations={msg.toolOperations} />}
                                <MarkdownContent content={msg.content} />
                                {msg.role === "user" && msg.contextPaths && msg.contextPaths.length > 0 && (
                                    <MessageContextPills paths={msg.contextPaths} />
                                )}
                            </div>
                        </div>
                    ))
                )}
                {isStreaming && (
                    <div className="flex items-center gap-2 text-[10px] opacity-40 px-2 font-mono uppercase tracking-widest">
                        <Loader2 className="w-3 h-3 animate-spin" />
                        Processing...
                    </div>
                )}
            </div>

            {/* Input & Search Area */}
            <div className="relative border-t border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
                {showFileSearch && (
                    <div className="absolute bottom-full left-0 w-full max-h-64 overflow-y-auto bg-[var(--color-surface-overlay)] border-t border-[var(--color-border-subtle)] shadow-[0_-10px_30px_rgba(0,0,0,0.5)] z-50">
                        {filteredFiles.length > 0 ? filteredFiles.map(file => (
                            <button
                                key={file}
                                onClick={() => handleSelectFile(file)}
                                className="w-full text-left px-4 py-2.5 text-xs hover:bg-[var(--color-accent-primary)] hover:text-[var(--color-surface-base)] transition-all flex items-center gap-3 border-b border-[var(--color-border-subtle)]"
                            >
                                <FileIcon className="w-3.5 h-3.5 opacity-40" />
                                <div className="flex flex-col truncate">
                                    <span className="font-medium">{file.split(/[/\\]/).pop()}</span>
                                    <span className="text-[9px] opacity-30 truncate">{file}</span>
                                </div>
                            </button>
                        )) : (
                            <div className="px-4 py-3 text-[10px] opacity-30 uppercase tracking-widest">No matching files</div>
                        )}
                    </div>
                )}

                <ContextPills />

                <div className="p-4 flex gap-3">
                    <div className="flex-1 relative">
                        <input
                            type="text"
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) handleSend();
                                if (e.key === "Escape") setShowFileSearch(false);
                            }}
                            placeholder="Type @ to search files..."
                            className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:border-[var(--color-accent-primary)] focus:bg-[var(--color-void-700)] outline-none transition-all placeholder:text-[var(--color-text-muted)]"
                        />
                    </div>
                    <button
                        onClick={isStreaming ? handleStop : handleSend}
                        className={`p-2.5 rounded-lg transition-all shadow-lg ${isStreaming
                            ? "bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500 hover:text-white"
                            : "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                            }`}
                    >
                        {isStreaming ? <StopCircle className="w-5 h-5" /> : <Send className="w-5 h-5" />}
                    </button>
                </div>
            </div>
        </div>
    );
}

function MessageContextPills({ paths }: { paths: string[] }) {
    return (
        <div className="mt-3 flex flex-wrap gap-1.5 pt-2 border-t border-[var(--color-surface-base)]/10">
            {paths.map((path) => (
                <div
                    key={path}
                    className="flex items-center gap-1.5 px-1.5 py-0.5 rounded bg-[var(--color-surface-base)]/10 text-[var(--color-surface-base)] border border-[var(--color-surface-base)]/10 text-[9px] font-medium"
                    title={path}
                >
                    <FileIcon className="w-2.5 h-2.5 opacity-60" />
                    <span className="truncate max-w-[120px]">{path.split(/[/\\]/).pop()}</span>
                </div>
            ))}
        </div>
    );
}

function ContextPills() {
    const contextPaths = useChatStore((state) => state.currentContextPaths());
    const { removeContextPath } = useChatStore();
    if (contextPaths.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-2 px-4 py-2 bg-[var(--color-void-800)] border-b border-[var(--color-border-subtle)] max-h-24 overflow-y-auto">
            {contextPaths.map(path => (
                <div key={path} className="flex items-center gap-2 px-2 py-1 rounded bg-[var(--color-void-700)] border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-muted)] group hover:border-[var(--color-accent-primary)] transition-all">
                    <FileIcon className="w-3 h-3 text-[var(--color-accent-primary)] opacity-50" />
                    <span className="truncate max-w-[150px]">{path.split(/[/\\]/).pop()}</span>
                    <button onClick={() => removeContextPath(path)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity ml-1">
                        <X className="w-3 h-3" />
                    </button>
                </div>
            ))}
        </div>
    );
}

function MarkdownContent({ content }: { content: string }) {
    return (
        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-code:text-[var(--color-accent-primary)] prose-code:bg-white/5 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-transparent prose-pre:p-0">
            <ReactMarkdown
                components={{
                    code({ node, inline, className, children, ...props }: any) {
                        const match = /language-(\w+)/.exec(className || "");
                        return !inline && match ? (
                            <div className="my-4 rounded-lg overflow-hidden border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] shadow-2xl">
                                <div className="flex items-center justify-between px-4 py-2 bg-[var(--color-void-800)] border-b border-[var(--color-border-subtle)] font-mono text-[9px] uppercase tracking-widest opacity-70">
                                    <span>{match[1]}</span>
                                    <button
                                        onClick={() => navigator.clipboard.writeText(String(children).replace(/\n$/, ""))}
                                        className="hover:text-[var(--color-accent-primary)] transition-colors font-bold"
                                    >
                                        [COPY]
                                    </button>
                                </div>
                                <SyntaxHighlighter
                                    {...props}
                                    style={vscDarkPlus}
                                    language={match[1]}
                                    PreTag="div"
                                    customStyle={{ margin: 0, padding: '1.25rem', background: 'transparent', fontSize: '0.85rem', lineHeight: '1.6' }}
                                >
                                    {String(children).replace(/\n$/, "")}
                                </SyntaxHighlighter>
                            </div>
                        ) : (
                            <code className={className} {...props}>{children}</code>
                        );
                    }
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}

function ToolOperationDisplay({ operations }: { operations: ToolOperation[] }) {
    if (!operations || operations.length === 0) return null;

    // Get unique operations (already merged by the store)
    const getStatusIcon = (status: string) => {
        if (status === "started") return <Loader2 className="w-3 h-3 animate-spin text-[var(--color-text-tertiary)]" />;
        if (status === "completed") return <Activity className="w-3 h-3 text-[var(--color-accent-success)]" />;
        return <Activity className="w-3 h-3 text-[var(--color-accent-error)]" />;
    };

    return (
        <div className="mb-3 space-y-1">
            {operations.map((op, i) => (
                <div
                    key={`${op.operation}-${op.target}-${i}`}
                    className="flex items-center gap-2 px-2 py-1.5 rounded bg-white/[0.02] border border-white/5 text-[10px]"
                >
                    {getStatusIcon(op.status)}
                    <span className="font-medium text-[var(--color-text-secondary)] truncate">{op.operation}</span>
                    <span className="text-[var(--color-text-muted)] truncate flex-1">{op.target.split(/[/\\]/).pop()}</span>
                </div>
            ))}
        </div>
    );
}
