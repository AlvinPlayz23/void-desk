import { useState, useRef, useEffect, useMemo } from "react";
import { Loader2, Sparkles, Trash2, Settings2, StopCircle, Activity, X, File as FileIcon, Plus, ChevronDown, Bug, FileText, CornerDownLeft, RefreshCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { invoke } from "@tauri-apps/api/core";
import { useAI } from "@/hooks/useAI";
import { useUIStore } from "@/stores/uiStore";
import { ChatSession, Message, ToolOperation, useChatStore } from "@/stores/chatStore";
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
    const [sessionSearch, setSessionSearch] = useState("");
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
                setSessionSearch("");
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
    const hasMessages = messages.length > 0;

    return (
        <div className="flex flex-col h-full bg-[var(--color-surface-base)]">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-white/5">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-gray-500" />
                    <div className="relative" ref={sessionsRef}>
                        <button
                            onClick={() => setShowSessions(!showSessions)}
                            className="flex items-center gap-1.5 bg-[#1c1c24] px-2.5 py-1 rounded-full border border-white/5 hover:border-white/10 transition-colors"
                            title="Sessions"
                        >
                            <div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                            <span className="text-[11px] font-medium text-gray-300">{currentSessionName}</span>
                            <ChevronDown className={`w-3 h-3 text-gray-500 transition-transform ${showSessions ? "rotate-180" : ""}`} />
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
                                <div className="px-2 py-1.5 border-b border-[var(--color-border-subtle)]">
                                    <input
                                        type="text"
                                        value={sessionSearch}
                                        onChange={(e) => setSessionSearch(e.target.value)}
                                        placeholder="Search sessions..."
                                        className="w-full px-2 py-1 bg-[var(--color-void-900)] border border-[var(--color-border-subtle)] rounded text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-primary)]"
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                </div>
                                {sessions
                                    .filter((session) => {
                                        if (!sessionSearch.trim()) return true;
                                        const q = sessionSearch.toLowerCase();
                                        if (session.name.toLowerCase().includes(q)) return true;
                                        return session.messages.some((m) => m.content.toLowerCase().includes(q));
                                    })
                                    .map((session) => (
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
                </div>
                <div className="flex items-center gap-2 text-gray-500">
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`hover:text-gray-300 transition-colors ${showDebug ? "text-emerald-500" : ""}`}
                        title="AI Debug"
                    >
                        <Bug className="w-4 h-4" />
                    </button>
                    <button onClick={handleNewSession} className="hover:text-gray-300 transition-colors" title="New Chat">
                        <Plus className="w-4 h-4" />
                    </button>
                    {messages.length > 0 && (
                        <button onClick={() => window.confirm("Clear history?") && clearChat()} className="hover:text-gray-300 transition-colors" title="Clear">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button onClick={() => openSettingsPage("ai")} className="hover:text-gray-300 transition-colors" title="AI Settings">
                        <Settings2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {showDebug && (
                    <div className="p-4 border-b border-white/5">
                        <DebugPanel debugLogs={debugLogs} clearDebugLogs={clearDebugLogs} />
                    </div>
                )}

                {!hasMessages ? (
                    <div className="flex-1 flex flex-col p-4">
                        <PromptComposer
                            input={input}
                            handleInputChange={handleInputChange}
                            setShowFileSearch={setShowFileSearch}
                            handleSend={handleSend}
                            handleStop={handleStop}
                            isStreaming={isStreaming}
                            activeModelName={activeModelName}
                            activeModelId={activeModelId}
                            aiModels={aiModels}
                            showModelMenu={showModelMenu}
                            setShowModelMenu={setShowModelMenu}
                            modelMenuRef={modelMenuRef}
                            setSelectedModelId={setSelectedModelId}
                            showFileSearch={showFileSearch}
                            filteredFiles={filteredFiles}
                            handleSelectFile={handleSelectFile}
                            dockedBottom={false}
                        />

                        {/* Empty state center - matching mock glow pattern */}
                        <div className="flex-1 flex flex-col items-center justify-center -mt-6">
                            <div className="relative w-32 h-32 flex items-center justify-center mb-8">
                                <div className="absolute inset-0 opacity-60" style={{
                                    backgroundImage: "radial-gradient(circle, #10b981 1px, transparent 1px)",
                                    backgroundSize: "6px 6px",
                                    maskImage: "radial-gradient(circle, black, transparent 80%)",
                                    WebkitMaskImage: "radial-gradient(circle, black, transparent 80%)",
                                }} />
                                <div className="w-16 h-16 rounded-full border border-emerald-500/10 flex items-center justify-center">
                                    <div className="w-10 h-10 rounded-full bg-emerald-500/5 flex items-center justify-center border border-emerald-500/10">
                                        <div className="w-1 h-1 rounded-full bg-emerald-500 shadow-[0_0_8px_#10b981]" />
                                    </div>
                                </div>
                            </div>

                            <div className="flex flex-col items-center gap-3 text-gray-500">
                                <div className="flex items-center gap-2">
                                    <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400">@</span>
                                    <span className="text-[12px]">to add files</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[10px] text-gray-400">@@</span>
                                    <span className="text-[12px]">to mention threads</span>
                                </div>
                                <div className="flex items-center gap-2 pt-4">
                                    <span className="text-[10px] uppercase tracking-widest text-gray-600 font-medium">Command Palette</span>
                                    <div className="flex gap-1">
                                        <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-gray-400">Ctrl</span>
                                        <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-gray-400">Shift</span>
                                        <span className="px-1.5 py-0.5 bg-white/5 border border-white/10 rounded text-[9px] font-bold text-gray-400">P</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Messages scroll area */}
                        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-5">
                            {messages.map((msg, idx) => (
                                <MessageBubble key={idx} message={msg} />
                            ))}
                            {isStreaming && (
                                <div className="flex items-center gap-2 text-[10px] opacity-40 px-2 font-mono uppercase tracking-widest">
                                    <Loader2 className="w-3 h-3 animate-spin" />
                                    Processing...
                                </div>
                            )}
                            {!isStreaming && messages.length > 0 && (
                                messages[messages.length - 1].content.includes("Invalid status code: 429") ||
                                messages[messages.length - 1].content.includes("Invalid status code: 422")
                            ) && (
                                <div className="flex items-center gap-2 px-2">
                                    <button
                                        onClick={retryLastMessage}
                                        className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-emerald-500 hover:text-emerald-400 transition-colors"
                                    >
                                        <RefreshCcw className="w-3 h-3" />
                                        Retry
                                    </button>
                                </div>
                            )}
                        </div>

                        {/* Bottom prompt */}
                        <div className="border-t border-white/5">
                            <ContextPills />
                            <PromptComposer
                                input={input}
                                handleInputChange={handleInputChange}
                                setShowFileSearch={setShowFileSearch}
                                handleSend={handleSend}
                                handleStop={handleStop}
                                isStreaming={isStreaming}
                                activeModelName={activeModelName}
                                activeModelId={activeModelId}
                                aiModels={aiModels}
                                showModelMenu={showModelMenu}
                                setShowModelMenu={setShowModelMenu}
                                modelMenuRef={modelMenuRef}
                                setSelectedModelId={setSelectedModelId}
                                showFileSearch={showFileSearch}
                                filteredFiles={filteredFiles}
                                handleSelectFile={handleSelectFile}
                                dockedBottom={true}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

function MessageBubble({ message }: { message: Message }) {
    const isUser = message.role === "user";
    const parts = message.parts ?? [];

    if (isUser) {
        return (
            <div className="flex flex-col items-end">
                <div className="max-w-[88%] rounded-2xl rounded-br-sm px-4 py-2.5 text-[13px] leading-relaxed bg-emerald-500/15 border border-emerald-500/20 text-gray-200">
                    <MarkdownContent content={message.content} />
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-start">
            <div className="max-w-[95%] text-[13px] leading-relaxed text-gray-300 space-y-2">
                {parts.map((part, i) => {
                    if (part.type === "text") {
                        return part.text ? <MarkdownContent key={i} content={part.text} /> : null;
                    }
                    return (
                        <ToolOperationDisplay key={part.id ?? i} operations={[part.toolOperation]} />
                    );
                })}
                {parts.length === 0 && message.content && (
                    <MarkdownContent content={message.content} />
                )}
            </div>
        </div>
    );
}

interface PromptComposerProps {
    input: string;
    handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    setShowFileSearch: (show: boolean) => void;
    handleSend: () => void;
    handleStop: () => void;
    isStreaming: boolean;
    activeModelName: string;
    activeModelId: string;
    aiModels: { id: string; name?: string }[];
    showModelMenu: boolean;
    setShowModelMenu: (show: boolean) => void;
    modelMenuRef: React.RefObject<HTMLDivElement | null>;
    setSelectedModelId: (id: string) => void;
    showFileSearch: boolean;
    filteredFiles: string[];
    handleSelectFile: (path: string) => void;
    dockedBottom: boolean;
}

function PromptComposer(props: PromptComposerProps) {
    const {
        input,
        handleInputChange,
        setShowFileSearch,
        handleSend,
        handleStop,
        isStreaming,
        activeModelName,
        activeModelId,
        aiModels,
        showModelMenu,
        setShowModelMenu,
        modelMenuRef,
        setSelectedModelId,
        showFileSearch,
        filteredFiles,
        handleSelectFile,
        dockedBottom,
    } = props;

    return (
        <div className={`relative ${dockedBottom ? "mx-3 mb-3 mt-2" : "mt-2"}`}>
            <div className="bg-[#16161e] border border-white/5 rounded-xl relative">
                {showFileSearch && (
                    <div className={`absolute left-0 w-full max-h-64 overflow-y-auto bg-[#16161e] border border-white/5 shadow-[0_10px_30px_rgba(0,0,0,0.6)] rounded-lg z-50 ${dockedBottom ? "bottom-full mb-2" : "top-full mt-2"}`}>
                        {filteredFiles.length > 0 ? filteredFiles.map(file => (
                            <button
                                key={file}
                                onClick={() => handleSelectFile(file)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors flex items-center gap-2.5 border-b border-white/5 last:border-b-0"
                            >
                                <FileIcon className="w-3.5 h-3.5 text-gray-500" />
                                <div className="flex flex-col truncate">
                                    <span className="font-medium text-gray-300">{file.split(/[/\\]/).pop()}</span>
                                    <span className="text-[9px] text-gray-600 truncate">{file}</span>
                                </div>
                            </button>
                        )) : (
                            <div className="px-3 py-3 text-[10px] text-gray-600 uppercase tracking-widest">No matching files</div>
                        )}
                    </div>
                )}

                <div className="px-3 pt-3 pb-1">
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
                        placeholder="Ask anything..."
                        rows={2}
                        className="w-full bg-transparent text-[14px] text-gray-300 placeholder:text-gray-600 resize-none focus:outline-none min-h-[2.5rem] max-h-[8rem] leading-relaxed"
                    />
                </div>

                <div className="flex items-center justify-between px-3 pb-2.5 pt-0.5 select-none">
                    <div className="flex items-center gap-2 text-gray-500 text-[10px]">
                        <div className="p-0.5 bg-white/5 rounded border border-white/5">
                            <CornerDownLeft className="w-3 h-3" />
                        </div>
                        <span>to send</span>
                    </div>

                    <div className="flex items-center gap-2" ref={modelMenuRef as React.RefObject<HTMLDivElement>}>
                        <button
                            onClick={() => setShowModelMenu(!showModelMenu)}
                            className="text-[9px] font-bold text-gray-600 tracking-tighter uppercase hover:text-gray-400 transition-colors cursor-pointer"
                            title="Select model"
                            disabled={aiModels.length === 0}
                        >
                            {activeModelName}
                        </button>
                        {isStreaming ? (
                            <button
                                onClick={handleStop}
                                className="flex items-center gap-1 bg-red-500/10 px-2 py-0.5 rounded border border-red-500/20 text-red-400 text-[9px] hover:bg-red-500/20 transition-colors"
                            >
                                <StopCircle className="w-2.5 h-2.5" />
                                <span>Stop</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleSend}
                                className="flex items-center gap-1 bg-white/5 px-1.5 py-0.5 rounded border border-white/5 text-gray-500 hover:text-gray-300 hover:border-white/10 transition-colors"
                            >
                                <span className="text-[9px]">^</span>
                                <CornerDownLeft className="w-2.5 h-2.5" />
                            </button>
                        )}
                        {showModelMenu && aiModels.length > 0 && (
                            <div className={`absolute right-3 w-52 max-h-56 overflow-y-auto bg-[#16161e] border border-white/10 rounded-lg shadow-xl z-50 ${dockedBottom ? "bottom-full mb-2" : "top-full mt-2"}`}>
                                {aiModels.map((model, index) => (
                                    <button
                                        key={`${model.id}-${index}`}
                                        onClick={() => {
                                            setSelectedModelId(model.id);
                                            setShowModelMenu(false);
                                        }}
                                        className={`w-full text-left px-3 py-2 text-xs hover:bg-white/5 border-b border-white/5 last:border-b-0 ${model.id === activeModelId ? "text-emerald-500" : "text-gray-300"}`}
                                    >
                                        <div className="truncate font-medium">
                                            {model.name || model.id || "Unnamed model"}
                                        </div>
                                        <div className="text-[10px] text-gray-600 truncate">{model.id}</div>
                                    </button>
                                ))}
                            </div>
                        )}
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
        <div className="flex flex-wrap gap-1.5 px-3 py-2 max-h-24 overflow-y-auto">
            {contextPaths.map(path => (
                <div key={path} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-white/5 border border-white/5 text-[10px] text-gray-400 group hover:border-emerald-500/30 transition-all">
                    <FileIcon className="w-3 h-3 text-emerald-500/50" />
                    <span className="truncate max-w-[150px]">{path.split(/[/\\]/).pop()}</span>
                    <button onClick={() => removeContextPath(path)} className="opacity-0 group-hover:opacity-100 hover:text-red-400 transition-opacity">
                        <X className="w-2.5 h-2.5" />
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
                    className="flex flex-col gap-2 px-3 py-2 rounded-md bg-[#1a1b26] border border-white/5 ring-1 ring-white/10 text-[10px]"
                >
                    <div className="flex items-center gap-2.5">
                        <FileText className="w-[16px] h-[16px] text-[var(--color-text-muted)]" />
                        <span className="font-mono text-[12px] text-[var(--color-text-secondary)] tracking-wide truncate flex-1">
                            {op.target}
                        </span>
                        {getStatusIcon(op.status)}
                    </div>
                    {op.details && op.details.trim() !== "" && (
                        <details className="text-[9px] text-[var(--color-text-muted)]">
                            <summary className="cursor-pointer uppercase tracking-widest">Diff</summary>
                            <pre className="mt-2 whitespace-pre-wrap font-mono text-[9px] text-[var(--color-text-secondary)]">
                                {op.details}
                            </pre>
                        </details>
                    )}
                </div>
            ))}
        </div>
    );
}

function DebugPanel({ debugLogs, clearDebugLogs }: { debugLogs: { timestamp: number; type: string; message: string }[]; clearDebugLogs: () => void }) {
    const [testOutput, setTestOutput] = useState<string>("");
    const [testLoading, setTestLoading] = useState(false);
    const { openAIKey, openAIBaseUrl, selectedModelId, aiModels, rawStreamLoggingEnabled, setRawStreamLoggingEnabled } = useSettingsStore();
    const modelId = selectedModelId || aiModels[0]?.id || "gpt-4o";

    const runToolCallTest = async () => {
        setTestLoading(true);
        setTestOutput("Running tool call test...\n");
        try {
            const result = await invoke<string>("debug_tool_call", {
                apiKey: openAIKey,
                baseUrl: openAIBaseUrl,
                modelId,
            });
            setTestOutput(result);
        } catch (err) {
            setTestOutput(`Error: ${err}`);
        }
        setTestLoading(false);
    };

    const runStreamTest = async () => {
        setTestLoading(true);
        setTestOutput("Running stream test...\n");
        try {
            const result = await invoke<string>("debug_stream_response", {
                apiKey: openAIKey,
                baseUrl: openAIBaseUrl,
                modelId,
            });
            setTestOutput(result);
        } catch (err) {
            setTestOutput(`Error: ${err}`);
        }
        setTestLoading(false);
    };

    const runAgentFlowTest = async () => {
        setTestLoading(true);
        setTestOutput("Running full agent flow test with tools...\n");
        try {
            const rootPath = useFileStore.getState().rootPath;
            const result = await invoke<string>("debug_agent_flow", {
                apiKey: openAIKey,
                baseUrl: openAIBaseUrl,
                modelId,
                projectPath: rootPath,
            });
            setTestOutput(result);
        } catch (err) {
            setTestOutput(`Error: ${err}`);
        }
        setTestLoading(false);
    };

    return (
        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-surface-overlay)] p-3 text-[10px]">
            <div className="flex items-center justify-between mb-2">
                <span className="uppercase tracking-widest text-[var(--color-text-tertiary)]">AI Debug</span>
                <div className="flex gap-2 flex-wrap">
                    <button
                        onClick={() => setRawStreamLoggingEnabled(!rawStreamLoggingEnabled)}
                        className={`px-2 py-1 rounded text-white ${rawStreamLoggingEnabled ? "bg-amber-600 hover:bg-amber-700" : "bg-zinc-700 hover:bg-zinc-600"}`}
                    >
                        Raw Stream {rawStreamLoggingEnabled ? "On" : "Off"}
                    </button>
                    <button
                        onClick={runToolCallTest}
                        disabled={testLoading}
                        className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 text-white disabled:opacity-50"
                    >
                        API Test
                    </button>
                    <button
                        onClick={runStreamTest}
                        disabled={testLoading}
                        className="px-2 py-1 rounded bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                    >
                        Stream Test
                    </button>
                    <button
                        onClick={runAgentFlowTest}
                        disabled={testLoading}
                        className="px-2 py-1 rounded bg-purple-600 hover:bg-purple-700 text-white disabled:opacity-50"
                    >
                        Agent Flow
                    </button>
                    <button
                        onClick={clearDebugLogs}
                        className="text-[10px] uppercase tracking-widest text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
                    >
                        Clear
                    </button>
                </div>
            </div>
            
            {testOutput && (
                <div className="mb-3 p-2 bg-black rounded max-h-60 overflow-y-auto">
                    <pre className="text-[9px] font-mono whitespace-pre-wrap text-green-400">{testOutput}</pre>
                </div>
            )}
            
            {debugLogs.length === 0 && !testOutput ? (
                <div className="opacity-50">No debug events yet. Click "Test Tool Call" to debug API.</div>
            ) : (
                <div className="space-y-1 max-h-40 overflow-y-auto">
                    {debugLogs.map((log, index) => (
                        <div key={`${log.timestamp}-${index}`} className="flex items-start gap-2">
                            <span className="opacity-50">{new Date(log.timestamp).toLocaleTimeString()}</span>
                            <span className={`uppercase tracking-widest ${log.type === "error" ? "text-red-400" : log.type === "retry" ? "text-amber-300" : log.type === "raw" ? "text-sky-300" : "text-[var(--color-text-secondary)]"}`}>
                                {log.type}
                            </span>
                            <span className="text-[var(--color-text-primary)]">{log.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
