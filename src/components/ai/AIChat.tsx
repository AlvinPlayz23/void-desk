import { useState, useRef, useEffect, useMemo } from "react";
import { Send, Loader2, Sparkles, Trash2, Settings2, StopCircle, Activity, X, File as FileIcon, Plus, ChevronDown, Bug } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { useAI } from "@/hooks/useAI";
import { useUIStore } from "@/stores/uiStore";
import { ChatSession, ToolOperation, useChatStore } from "@/stores/chatStore";
import { useFileStore } from "@/stores/fileStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function AIChat() {
    const { messages, isStreaming, sendMessage, stopStreaming, retryLastMessage } = useAI();
    const openSettingsPage = useUIStore((state) => state.openSettingsPage);
    const createSession = useChatStore((state) => state.createSession);
    const deleteSession = useChatStore((state) => state.deleteSession);
    const switchSession = useChatStore((state) => state.switchSession);
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const rootPath = useFileStore((state) => state.rootPath);

    const [input, setInput] = useState("");
    const [showFileSearch, setShowFileSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSessions, setShowSessions] = useState(false);
    const [showDebug, setShowDebug] = useState(false);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [sessions, setSessions] = useState<ChatSession[]>([]);
    const { fileTree } = useFileStore();
    const storedSessions = useChatStore((state) => state.sessions);
    const clearDebugLogs = useChatStore((state) => state.clearDebugLogs);
    const aiModels = useSettingsStore((state) => state.aiModels);
    const selectedModelId = useSettingsStore((state) => state.selectedModelId);
    const setSelectedModelId = useSettingsStore((state) => state.setSelectedModelId);
    const scrollRef = useRef<HTMLDivElement>(null);
    const sessionsRef = useRef<HTMLDivElement>(null);
    const modelMenuRef = useRef<HTMLDivElement>(null);

    const currentSession = useMemo(
        () => storedSessions.find((session) => session.id === activeSessionId) || null,
        [activeSessionId, storedSessions]
    );
    const debugLogs = currentSession?.debugLogs || [];

    // Initialize first session
    useEffect(() => {
        if (!activeSessionId) {
            createSession("New Chat", rootPath ?? null);
        }
    }, [activeSessionId, createSession, rootPath]);

    // Load sessions
    useEffect(() => {
        loadSessions();
    }, [rootPath, storedSessions]);

    const loadSessions = async () => {
        try {
            const localSessions = useChatStore.getState().sessions;
            const workspaceSessions = localSessions.filter((session) => {
                if (!session.workspacePath) return true;
                return rootPath ? session.workspacePath === rootPath : false;
            });
            const sortedSessions = [...workspaceSessions].sort((a, b) => b.lastUpdated - a.lastUpdated);
            setSessions(sortedSessions);
        } catch (error) {
            console.error("Failed to load sessions:", error);
        }
    };

    const handleNewSession = () => {
        const id = createSession("New Chat", rootPath ?? null);
        switchSession(id);
        loadSessions();
        setShowSessions(false);
    };

    const handleDeleteSession = async (id: string) => {
        if (window.confirm("Delete this chat session?")) {
            deleteSession(id);
            await loadSessions();
        }
    };

    // Close sessions menu when clicking outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) {
                setShowSessions(false);
            }
            if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
                setShowModelMenu(false);
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

    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
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

    const currentSessionName = currentSession?.name || "Chat";
    const activeModelId = selectedModelId || aiModels[0]?.id || "gpt-4o";
    const activeModelName =
        aiModels.find((model) => model.id === activeModelId)?.name || activeModelId || "Model";

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
                                {sessions.map((session) => (
                                    <div
                                        key={session.id}
                                        className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)] group ${activeSessionId === session.id ? "bg-[var(--color-void-700)] text-[var(--color-accent-primary)]" : ""}`}
                                        role="button"
                                        tabIndex={0}
                                        onClick={() => { switchSession(session.id); setShowSessions(false); }}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter" || event.key === " ") {
                                                switchSession(session.id);
                                                setShowSessions(false);
                                            }
                                        }}
                                    >
                                        <div className="flex-1 truncate">
                                            <div className="truncate font-medium">{session.name}</div>
                                            <div className="text-[9px] opacity-30">{new Date(session.createdAt).toLocaleDateString()}</div>
                                        </div>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); handleDeleteSession(session.id); }}
                                            className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                                            type="button"
                                        >
                                            <Trash2 className="w-3 h-3" />
                                        </button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`icon-btn p-1.5 hover:bg-[var(--color-void-700)] rounded ${showDebug ? "text-[var(--color-accent-primary)]" : ""}`}
                        title="AI Debug"
                    >
                        <Bug className="w-3.5 h-3.5 opacity-70" />
                    </button>
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
                {showDebug && (
                    <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] p-3 text-[10px]">
                        <div className="flex items-center justify-between mb-2">
                            <span className="uppercase tracking-widest text-[var(--color-text-tertiary)]">AI Debug</span>
                            <button
                                onClick={clearDebugLogs}
                                className="text-[10px] uppercase tracking-widest text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                            >
                                Clear
                            </button>
                        </div>
                        {debugLogs.length === 0 ? (
                            <div className="opacity-50">No debug events yet.</div>
                        ) : (
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                                {debugLogs.map((log, index) => (
                                    <div key={`${log.timestamp}-${index}`} className="flex items-start gap-2">
                                        <span className="opacity-50">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                        <span className={`uppercase tracking-widest ${log.type === "error" ? "text-red-400" : log.type === "retry" ? "text-amber-300" : "text-[var(--color-text-secondary)]"}`}>
                                            {log.type}
                                        </span>
                                        <span className="text-[var(--color-text-primary)]">{log.message}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}
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
                {!isStreaming && messages.length > 0 && (
                    messages[messages.length - 1].content.includes("Error: Stream error: Model error: Stream error: stream failed: Invalid status code: 429") ||
                    messages[messages.length - 1].content.includes("Error: Stream error: Model error: Stream error: stream failed: Invalid status code: 422")
                ) && (
                    <div className="flex items-center gap-2 px-2">
                        <button
                            onClick={retryLastMessage}
                            className="text-[10px] uppercase tracking-widest text-[var(--color-accent-primary)] hover:text-[var(--color-text-primary)]"
                        >
                            Retry
                        </button>
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

                <div className="mx-4 mb-3 mt-4 rounded-xl border border-[#27272a] bg-[#18181b] shadow-2xl shadow-black/50 overflow-hidden ring-1 ring-white/[0.02]">
                    <div className="relative px-4 pt-4 pb-2">
                        <textarea
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                                if (e.key === "Escape") setShowFileSearch(false);
                            }}
                            placeholder="Ask anything... Use '@' to show code, files, and docs to the AI"
                            rows={2}
                            className="w-full bg-transparent text-lg text-zinc-200 placeholder:text-zinc-500 resize-none focus:outline-none h-[3.5rem] font-normal leading-relaxed tracking-normal"
                        />
                    </div>
                    <div className="flex items-center justify-between px-3 pb-3 pt-1 select-none">
                        <div className="flex items-center gap-1" ref={modelMenuRef}>
                            <button
                                onClick={() => setShowModelMenu(!showModelMenu)}
                                className="flex items-center gap-1.5 px-2 py-1.5 rounded-md hover:bg-zinc-800/70 transition-colors group cursor-pointer"
                                title="Select model"
                                disabled={aiModels.length === 0}
                            >
                                <span className="text-sm text-zinc-300 font-medium group-hover:text-zinc-100">
                                    {activeModelName}
                                </span>
                                <ChevronDown className={`w-3.5 h-3.5 text-zinc-500 group-hover:text-zinc-300 transition-colors ${showModelMenu ? "rotate-180" : ""}`} />
                            </button>
                            {showModelMenu && aiModels.length > 0 && (
                                <div className="absolute left-3 bottom-full mb-2 w-52 max-h-56 overflow-y-auto bg-[#18181b] border border-[#27272a] rounded-lg shadow-xl z-50">
                                    {aiModels.map((model, index) => (
                                        <button
                                            key={`${model.id}-${index}`}
                                            onClick={() => {
                                                setSelectedModelId(model.id);
                                                setShowModelMenu(false);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs hover:bg-zinc-800/70 border-b border-[#27272a] last:border-b-0 ${model.id === activeModelId ? "text-[var(--color-accent-primary)]" : "text-zinc-200"}`}
                                        >
                                            <div className="truncate font-medium">
                                                {model.name || model.id || "Unnamed model"}
                                            </div>
                                            <div className="text-[10px] opacity-50 truncate">{model.id}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <button
                            onClick={isStreaming ? handleStop : handleSend}
                            className={`flex items-center justify-center w-10 h-10 rounded-lg transition-all ${isStreaming
                                ? "bg-red-500/20 border border-red-500/50 text-red-400 hover:bg-red-500 hover:text-white"
                                : "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] hover:shadow-[0_0_20px_rgba(99,102,241,0.4)]"
                                }`}
                            title={isStreaming ? "Stop" : "Send"}
                        >
                            {isStreaming ? <StopCircle className="w-4.5 h-4.5" /> : <Send className="w-4.5 h-4.5" />}
                        </button>
                    </div>
                </div>
            </div>
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
