import { memo, useState, useRef, useEffect, useMemo } from "react";
import { Loader2, Sparkles, Trash2, Settings2, StopCircle, X, File as FileIcon, Plus, ChevronDown, Bug, CornerDownLeft, RefreshCcw, Paperclip } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { vscDarkPlus } from "react-syntax-highlighter/dist/esm/styles/prism";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { useAI } from "@/hooks/useAI";
import { useUIStore } from "@/stores/uiStore";
import {
    ChatAttachment,
    Message,
    PersistedChatState,
    ToolOperation,
    selectCurrentContextPaths,
    useChatStore,
} from "@/stores/chatStore";
import { useFileStore } from "@/stores/fileStore";
import { AIProviderPreset, selectActiveAISettings, useSettingsStore } from "@/stores/settingsStore";

export function AIChat() {
    const { messages, isStreaming, sendMessage, stopStreaming, retryLastMessage } = useAI();
    const openSettingsPage = useUIStore((state) => state.openSettingsPage);
    const createSession = useChatStore((state) => state.createSession);
    const deleteSession = useChatStore((state) => state.deleteSession);
    const switchSession = useChatStore((state) => state.switchSession);
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const isHydrated = useChatStore((state) => state.isHydrated);
    const replaceState = useChatStore((state) => state.replaceState);
    const setHydrated = useChatStore((state) => state.setHydrated);
    const rootPath = useFileStore((state) => state.rootPath);

    const [input, setInput] = useState("");
    const [showFileSearch, setShowFileSearch] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [showSessions, setShowSessions] = useState(false);
    const [sessionSearch, setSessionSearch] = useState("");
    const [showDebug, setShowDebug] = useState(false);
    const [showPresetMenu, setShowPresetMenu] = useState(false);
    const [showModelMenu, setShowModelMenu] = useState(false);
    const [draftAttachments, setDraftAttachments] = useState<ChatAttachment[]>([]);
    const fileTree = useFileStore((state) => state.fileTree);
    const storedSessions = useChatStore((state) => state.sessions);
    const clearDebugLogs = useChatStore((state) => state.clearDebugLogs);
    const addDebugLog = useChatStore((state) => state.addDebugLog);
    const activeAISettings = useSettingsStore(useShallow(selectActiveAISettings));
    const providerPresetsEnabled = useSettingsStore((state) => state.providerPresetsEnabled);
    const providerPresets = useSettingsStore((state) => state.providerPresets);
    const selectedProviderPresetId = useSettingsStore((state) => state.selectedProviderPresetId);
    const setSelectedProviderPresetId = useSettingsStore((state) => state.setSelectedProviderPresetId);
    const setSelectedModelId = useSettingsStore((state) => state.setSelectedModelId);
    const setPresetSelectedModelId = useSettingsStore((state) => state.setPresetSelectedModelId);
    const scrollRef = useRef<HTMLDivElement>(null);
    const sessionsRef = useRef<HTMLDivElement>(null);
    const presetMenuRef = useRef<HTMLDivElement>(null);
    const saveTimerRef = useRef<number | null>(null);

    const currentSession = useMemo(
        () => storedSessions.find((session) => session.id === activeSessionId) || null,
        [activeSessionId, storedSessions]
    );
    const debugLogs = currentSession?.debugLogs || [];

    useEffect(() => {
        let cancelled = false;

        const loadChatState = async () => {
            try {
                const loaded = await invoke<PersistedChatState>("load_chat_state");
                if (!cancelled) {
                    replaceState(loaded);
                }
            } catch (error) {
                console.error("Failed to load chat state:", error);
            } finally {
                if (!cancelled) {
                    setHydrated(true);
                }
            }
        };

        loadChatState();

        return () => {
            cancelled = true;
        };
    }, [replaceState, setHydrated]);

    // Initialize first session
    useEffect(() => {
        if (!isHydrated) return;
        if (!activeSessionId && storedSessions.length === 0) {
            createSession("New Chat", rootPath ?? null);
        }
    }, [activeSessionId, createSession, isHydrated, rootPath, storedSessions.length]);

    useEffect(() => {
        if (!isHydrated) return;

        if (saveTimerRef.current) {
            window.clearTimeout(saveTimerRef.current);
        }

        saveTimerRef.current = window.setTimeout(() => {
            invoke("save_chat_state", {
                state: {
                    sessions: storedSessions,
                    activeSessionId,
                } satisfies PersistedChatState,
            }).catch((error) => {
                console.error("Failed to save chat state:", error);
            });
            saveTimerRef.current = null;
        }, 300);

        return () => {
            if (saveTimerRef.current) {
                window.clearTimeout(saveTimerRef.current);
                saveTimerRef.current = null;
            }
        };
    }, [activeSessionId, isHydrated, storedSessions]);

    const sessions = useMemo(() => {
        const workspaceSessions = storedSessions.filter((session) => {
            if (!session.workspacePath) return true;
            return rootPath ? session.workspacePath === rootPath : false;
        });
        return [...workspaceSessions].sort((a, b) => b.lastUpdated - a.lastUpdated);
    }, [rootPath, storedSessions]);

    const visibleSessions = useMemo(() => {
        if (!sessionSearch.trim()) return sessions;
        const q = sessionSearch.toLowerCase();
        return sessions.filter((session) => {
            if (session.name.toLowerCase().includes(q)) return true;
            return session.messages.some((message) => message.content.toLowerCase().includes(q));
        });
    }, [sessionSearch, sessions]);

    const handleNewSession = () => {
        const id = createSession("New Chat", rootPath ?? null);
        switchSession(id);
        setShowSessions(false);
    };

    const handleDeleteSession = (id: string) => {
        if (window.confirm("Delete this chat session?")) {
            deleteSession(id);
        }
    };

    // Close sessions menu when clicking outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (sessionsRef.current && !sessionsRef.current.contains(e.target as Node)) {
                setShowSessions(false);
                setSessionSearch("");
            }
            if (presetMenuRef.current && !presetMenuRef.current.contains(e.target as Node)) {
                setShowPresetMenu(false);
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

    const activePreset = activeAISettings.activePreset;
    const aiModels = activeAISettings.aiModels;
    const activeModelId = activeAISettings.selectedModelId || aiModels[0]?.id || "gpt-4o";
    const activeModelName =
        aiModels.find((model) => model.id === activeModelId)?.name || activeModelId || "Model";
    const activeModel = activeAISettings.activeModel || aiModels.find((m) => m.id === activeModelId);
    const activePresetName = activePreset?.name || "Preset";
    const supportsImages = activeModel?.supportsImages ?? false;
    const summarizeAttachments = (attachments: ChatAttachment[]) =>
        attachments
            .map((attachment) => attachment.kind === "text"
                ? `${attachment.name} [text ${attachment.textContent.length} chars]`
                : `${attachment.name} [image ~${Math.round(attachment.dataUrl.length / 1024)}KB data-url]`
            )
            .join(", ");

    const handlePasteImage = (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        const imageItems: DataTransferItem[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith("image/")) {
                imageItems.push(items[i]);
            }
        }
        if (imageItems.length === 0) return;

        if (!supportsImages) {
            addDebugLog({
                timestamp: Date.now(),
                type: "warn",
                message: `Pasted image ignored because model ${activeModelId} does not support images`,
            });
            return;
        }

        e.preventDefault();

        for (const item of imageItems) {
            const file = item.getAsFile();
            if (!file) continue;

            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = reader.result as string;
                const att: ChatAttachment = {
                    id: `paste-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    kind: "image",
                    name: file.name || "pasted-image.png",
                    mimeType: file.type || "image/png",
                    dataUrl,
                    preparedForModelId: activeModelId,
                };
                setDraftAttachments((prev) => [...prev, att]);
                addDebugLog({
                    timestamp: Date.now(),
                    type: "attachment",
                    message: `Pasted image added: ${att.name} [~${Math.round(dataUrl.length / 1024)}KB data-url]`,
                });
            };
            reader.readAsDataURL(file);
        }
    };

    const handleAddAttachment = async () => {
        try {
            addDebugLog({
                timestamp: Date.now(),
                type: "attachment",
                message: `Opening attachment picker for model ${activeModelId} (${supportsImages ? "vision-enabled" : "text-only"})`,
            });

            const filters = supportsImages
                ? [
                    { name: "All Supported", extensions: ["txt", "md", "json", "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "css", "html", "xml", "yaml", "yml", "toml", "sh", "sql", "png", "jpg", "jpeg", "gif", "webp"] },
                    { name: "Text Files", extensions: ["txt", "md", "json", "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "css", "html", "xml", "yaml", "yml", "toml", "sh", "sql"] },
                    { name: "Images", extensions: ["png", "jpg", "jpeg", "gif", "webp"] },
                ]
                : [
                    { name: "Text Files", extensions: ["txt", "md", "json", "ts", "tsx", "js", "jsx", "rs", "py", "go", "java", "c", "cpp", "h", "css", "html", "xml", "yaml", "yml", "toml", "sh", "sql"] },
                ];

            const selected = await open({ multiple: true, filters });
            if (!selected) {
                addDebugLog({
                    timestamp: Date.now(),
                    type: "attachment",
                    message: "Attachment picker cancelled",
                });
                return;
            }

            const paths = Array.isArray(selected) ? selected : [selected];
            addDebugLog({
                timestamp: Date.now(),
                type: "attachment",
                message: `Preparing ${paths.length} attachment(s): ${paths.map((path) => path.split(/[/\\]/).pop() || path).join(", ")}`,
            });

            const prepared = (await invoke<ChatAttachment[]>("prepare_chat_attachments", { paths })).map((attachment) => ({
                ...attachment,
                preparedForModelId: activeModelId,
            }));

            // Reject images if model doesn't support them
            const filtered = supportsImages
                ? prepared
                : prepared.filter((a) => a.kind !== "image");

            const rejectedCount = prepared.length - filtered.length;
            if (rejectedCount > 0) {
                addDebugLog({
                    timestamp: Date.now(),
                    type: "warn",
                    message: `Skipped ${rejectedCount} image attachment(s) because model ${activeModelId} does not support images`,
                });
            }

            addDebugLog({
                timestamp: Date.now(),
                type: "attachment",
                message: filtered.length > 0
                    ? `Added ${filtered.length} draft attachment(s): ${summarizeAttachments(filtered)}`
                    : "No supported attachments were added",
            });

            setDraftAttachments((prev) => [...prev, ...filtered]);
        } catch (err) {
            console.error("Failed to add attachment:", err);
            addDebugLog({
                timestamp: Date.now(),
                type: "error",
                message: `Failed to prepare attachment(s): ${String(err)}`,
            });
        }
    };

    const removeAttachment = (id: string) => {
        const removed = draftAttachments.find((attachment) => attachment.id === id);
        if (removed) {
            addDebugLog({
                timestamp: Date.now(),
                type: "attachment",
                message: `Removed draft attachment ${removed.name}`,
            });
        }
        setDraftAttachments((prev) => prev.filter((a) => a.id !== id));
    };

    const handleSend = async () => {
        if ((!input.trim() && draftAttachments.length === 0) || isStreaming) return;
        const text = input;
        const atts = [...draftAttachments];
        const imageAttachments = atts.filter((attachment) => attachment.kind === "image");
        const preparedModelIds = [...new Set(atts.map((attachment) => attachment.preparedForModelId).filter(Boolean))];

        addDebugLog({
            timestamp: Date.now(),
            type: "send",
            message: `Composer send triggered: model=${activeModelId}, prompt=${text.length} chars, draftAttachments=${atts.length}${atts.length > 0 ? ` (${summarizeAttachments(atts)})` : ""}`,
        });

        if (imageAttachments.length > 0 && !supportsImages) {
            addDebugLog({
                timestamp: Date.now(),
                type: "error",
                message: `Blocked send: model ${activeModelId} is not marked as vision-enabled, but ${imageAttachments.length} image attachment(s) are queued${preparedModelIds.length > 0 ? ` (prepared under ${preparedModelIds.join(", ")})` : ""}`,
            });
            return;
        }

        if (imageAttachments.length > 0 && preparedModelIds.length > 0 && !preparedModelIds.includes(activeModelId)) {
            addDebugLog({
                timestamp: Date.now(),
                type: "warn",
                message: `Sending image attachment(s) with model ${activeModelId}, but they were prepared while ${preparedModelIds.join(", ")} was selected`,
            });
        }

        setInput("");
        setDraftAttachments([]);
        await sendMessage(text, atts);
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
    const hasMessages = messages.length > 0;

    return (
        <div className="flex flex-col h-full bg-[var(--color-surface-base)] font-sans selection:bg-[var(--color-accent-primary)]/20 selection:text-[var(--color-text-primary)]">
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-[var(--color-text-muted)]" />
                    <div className="relative" ref={sessionsRef}>
                        <button
                            onClick={() => setShowSessions(!showSessions)}
                            className="flex items-center gap-1.5 bg-[var(--color-surface-overlay)] px-2.5 py-1 rounded-full border border-[var(--color-border-subtle)] hover:border-[var(--color-border-default)] transition-colors"
                            title="Sessions"
                        >
                            <div className="w-1.5 h-1.5 rounded-full bg-[var(--color-accent-success)]" />
                            <span className="text-[11px] font-medium text-[var(--color-text-secondary)]">{currentSessionName}</span>
                            <ChevronDown className={`w-3 h-3 text-[var(--color-text-muted)] transition-transform ${showSessions ? "rotate-180" : ""}`} />
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
                                {visibleSessions
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
                                                className="opacity-0 group-hover:opacity-100 p-1 hover:text-[var(--color-accent-error)] transition-opacity"
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
                <div className="flex items-center gap-2 text-[var(--color-text-muted)]">
                    <button
                        onClick={() => setShowDebug(!showDebug)}
                        className={`hover:text-[var(--color-text-secondary)] transition-colors ${showDebug ? "text-[var(--color-accent-success)]" : ""}`}
                        title="AI Debug"
                    >
                        <Bug className="w-4 h-4" />
                    </button>
                    <button onClick={handleNewSession} className="hover:text-[var(--color-text-secondary)] transition-colors" title="New Chat">
                        <Plus className="w-4 h-4" />
                    </button>
                    {messages.length > 0 && (
                        <button onClick={() => window.confirm("Clear history?") && clearChat()} className="hover:text-[var(--color-text-secondary)] transition-colors" title="Clear">
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button onClick={() => openSettingsPage("ai")} className="hover:text-[var(--color-text-secondary)] transition-colors" title="AI Settings">
                        <Settings2 className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 flex flex-col overflow-hidden">
                {showDebug && (
                    <div className="p-4 border-b border-[var(--color-border-subtle)]">
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
                            providerPresetsEnabled={providerPresetsEnabled}
                            providerPresets={providerPresets}
                            activePresetName={activePresetName}
                            activePresetId={selectedProviderPresetId}
                            activeModelName={activeModelName}
                            activeModelId={activeModelId}
                            aiModels={aiModels}
                            showPresetMenu={showPresetMenu}
                            setShowPresetMenu={setShowPresetMenu}
                            showModelMenu={showModelMenu}
                            presetMenuRef={presetMenuRef}
                            setShowModelMenu={setShowModelMenu}
                            setSelectedProviderPresetId={setSelectedProviderPresetId}
                            setSelectedModelId={setSelectedModelId}
                            setPresetSelectedModelId={setPresetSelectedModelId}
                            showFileSearch={showFileSearch}
                            filteredFiles={filteredFiles}
                            handleSelectFile={handleSelectFile}
                            dockedBottom={false}
                            draftAttachments={draftAttachments}
                            handleAddAttachment={handleAddAttachment}
                            removeAttachment={removeAttachment}
                            supportsImages={supportsImages}
                            onPaste={handlePasteImage}
                        />

                        {/* Empty state center - matching mock glow pattern */}
                        <div className="flex-1 flex flex-col items-center justify-center -mt-6">
                            <div className="text-center space-y-6">
                                <h1 className="text-5xl font-black tracking-tighter uppercase" style={{ WebkitTextStroke: '1px rgba(255,255,255,0.1)', color: 'transparent' }}>
                                    Void<span className="text-[var(--color-accent-primary)]" style={{ WebkitTextStroke: '0' }}>.</span>
                                </h1>
                                <div className="flex flex-col gap-2 pt-4">
                                    <div className="flex items-center justify-center gap-2 text-[var(--color-text-muted)] text-xs font-mono uppercase tracking-widest">
                                        <span className="px-1.5 py-0.5 bg-[var(--color-accent-primary)]/10 text-[var(--color-accent-primary)] border border-[var(--color-accent-primary)]/20 rounded-sm">@</span>
                                        <span>Add Context Files</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    <>
                        {/* Messages scroll area */}
                        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-5">
                            {messages.map((msg) => (
                                <MessageBubble key={msg.id} message={msg} />
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
                                            className="flex items-center gap-1.5 text-[10px] uppercase tracking-widest text-[var(--color-accent-success)] hover:text-[var(--color-accent-success)]/80 transition-colors"
                                        >
                                            <RefreshCcw className="w-3 h-3" />
                                            Retry
                                        </button>
                                    </div>
                                )}
                        </div>

                        {/* Bottom prompt */}
                        <div className="border-t border-[var(--color-border-subtle)]">
                            <ContextPills />
                            <PromptComposer
                                input={input}
                                handleInputChange={handleInputChange}
                                setShowFileSearch={setShowFileSearch}
                                handleSend={handleSend}
                                handleStop={handleStop}
                                isStreaming={isStreaming}
                                providerPresetsEnabled={providerPresetsEnabled}
                                providerPresets={providerPresets}
                                activePresetName={activePresetName}
                                activePresetId={selectedProviderPresetId}
                                activeModelName={activeModelName}
                                activeModelId={activeModelId}
                                aiModels={aiModels}
                                showPresetMenu={showPresetMenu}
                                setShowPresetMenu={setShowPresetMenu}
                                showModelMenu={showModelMenu}
                                presetMenuRef={presetMenuRef}
                                setShowModelMenu={setShowModelMenu}
                                setSelectedProviderPresetId={setSelectedProviderPresetId}
                                setSelectedModelId={setSelectedModelId}
                                setPresetSelectedModelId={setPresetSelectedModelId}
                                showFileSearch={showFileSearch}
                                filteredFiles={filteredFiles}
                                handleSelectFile={handleSelectFile}
                                dockedBottom={true}
                                draftAttachments={draftAttachments}
                                handleAddAttachment={handleAddAttachment}
                                removeAttachment={removeAttachment}
                                supportsImages={supportsImages}
                                onPaste={handlePasteImage}
                            />
                        </div>
                    </>
                )}
            </div>
        </div>
    );
}

const MessageBubble = memo(function MessageBubble({ message }: { message: Message }) {
    const isUser = message.role === "user";
    const parts = message.parts ?? [];

    if (isUser) {
        return (
            <div className="flex flex-col items-end w-full mb-6">
                <div className="max-w-[85%] text-[13.5px] leading-relaxed text-[var(--color-text-primary)] font-normal px-5 py-3.5 bg-[var(--color-surface-overlay)] border border-[var(--color-border-default)] rounded-2xl rounded-br-sm" style={{ fontFamily: "var(--font-sans)" }}>
                    <MarkdownContent content={message.content} />
                    {message.attachments && message.attachments.length > 0 && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                            {message.attachments.map((att) => (
                                <div key={att.id}>
                                    {att.kind === "image" ? (
                                        <div className="w-20 h-20 rounded-lg overflow-hidden border border-white/10">
                                            <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                                        </div>
                                    ) : (
                                        <div className="flex items-center gap-1 px-2 py-0.5 rounded bg-white/10 text-[9px] text-gray-300">
                                            <FileIcon className="w-2.5 h-2.5" />
                                            <span className="truncate max-w-[80px]">{att.name}</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col items-start w-full mb-8">
            <div className="max-w-[95%] text-[14px] leading-[1.7] text-[var(--color-text-secondary)] space-y-4" style={{ fontFamily: "var(--font-sans)" }}>
                {parts.map((part, i) => {
                    if (part.type === "text") {
                        return part.text ? <MarkdownContent key={i} content={part.text} /> : null;
                    }
                    if (part.type === "reasoning") {
                        return part.text || (part.innerTools && part.innerTools.length > 0)
                            ? <ReasoningBlock key={i} text={part.text} innerTools={part.innerTools} />
                            : null;
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
});

interface PromptComposerProps {
    input: string;
    handleInputChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
    setShowFileSearch: (show: boolean) => void;
    handleSend: () => void;
    handleStop: () => void;
    isStreaming: boolean;
    providerPresetsEnabled: boolean;
    providerPresets: AIProviderPreset[];
    activePresetName: string;
    activePresetId: string;
    activeModelName: string;
    activeModelId: string;
    aiModels: { id: string; name?: string; supportsImages?: boolean }[];
    showPresetMenu: boolean;
    setShowPresetMenu: (show: boolean) => void;
    showModelMenu: boolean;
    setShowModelMenu: (show: boolean) => void;
    presetMenuRef: React.RefObject<HTMLDivElement | null>;
    setSelectedProviderPresetId: (id: string) => void;
    setSelectedModelId: (id: string) => void;
    setPresetSelectedModelId: (presetId: string, modelId: string) => void;
    showFileSearch: boolean;
    filteredFiles: string[];
    handleSelectFile: (path: string) => void;
    dockedBottom: boolean;
    draftAttachments: ChatAttachment[];
    handleAddAttachment: () => void;
    removeAttachment: (id: string) => void;
    supportsImages: boolean;
    onPaste: (e: React.ClipboardEvent) => void;
}

function PromptComposer(props: PromptComposerProps) {
    const {
        input,
        handleInputChange,
        setShowFileSearch,
        handleSend,
        handleStop,
        isStreaming,
        providerPresetsEnabled,
        providerPresets,
        activePresetName,
        activePresetId,
        activeModelName,
        activeModelId,
        aiModels,
        showPresetMenu,
        setShowPresetMenu,
        showModelMenu,
        setShowModelMenu,
        presetMenuRef,
        setSelectedProviderPresetId,
        setSelectedModelId,
        setPresetSelectedModelId,
        showFileSearch,
        filteredFiles,
        handleSelectFile,
        dockedBottom,
        draftAttachments,
        handleAddAttachment,
        removeAttachment,
        onPaste,
    } = props;

    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea on input
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = "auto";
        ta.style.height = Math.min(ta.scrollHeight, 200) + "px";
    }, [input]);

    return (
        <div className={`relative ${dockedBottom ? "mx-4 mb-4 mt-2" : "mt-2"}`}>
            <div className="bg-[var(--color-surface-elevated)] border border-[var(--color-border-default)] relative shadow-[0_0_0_1px_rgba(255,255,255,0.04)] transition-all focus-within:shadow-[0_0_10px_rgba(99,102,241,0.15),0_0_0_1px_rgba(99,102,241,0.3)] focus-within:border-[var(--color-accent-primary)] rounded-xl">
                {showFileSearch && (
                    <div className={`absolute left-0 w-full max-h-64 overflow-y-auto bg-[var(--color-surface-overlay)] border border-[var(--color-border-subtle)] shadow-[0_10px_30px_rgba(0,0,0,0.6)] rounded-xl z-50 ${dockedBottom ? "bottom-full mb-2" : "top-full mt-2"}`}>
                        {filteredFiles.length > 0 ? filteredFiles.map(file => (
                            <button
                                key={file}
                                onClick={() => handleSelectFile(file)}
                                className="w-full text-left px-3 py-2 text-xs hover:bg-white/5 transition-colors flex items-center gap-2.5 border-b border-[var(--color-border-subtle)] last:border-b-0"
                            >
                                <FileIcon className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                                <div className="flex flex-col truncate">
                                    <span className="font-medium text-[var(--color-text-secondary)]">{file.split(/[/\\]/).pop()}</span>
                                    <span className="text-[9px] text-[var(--color-text-muted)] truncate">{file}</span>
                                </div>
                            </button>
                        )) : (
                            <div className="px-3 py-3 text-[10px] text-[var(--color-text-muted)] uppercase tracking-widest">No matching files</div>
                        )}
                    </div>
                )}

                {draftAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-2 px-3 pt-3 pb-1">
                        {draftAttachments.map((att) => (
                            <div key={att.id} className="relative group">
                                {att.kind === "image" ? (
                                    <div className="w-16 h-16 rounded-lg overflow-hidden border border-white/10">
                                        <img src={att.dataUrl} alt={att.name} className="w-full h-full object-cover" />
                                    </div>
                                ) : (
                                    <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/5 border border-white/5 text-[10px] text-gray-400">
                                        <FileIcon className="w-3 h-3" />
                                        <span className="truncate max-w-[100px]">{att.name}</span>
                                    </div>
                                )}
                                <button
                                    onClick={() => removeAttachment(att.id)}
                                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500/80 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X className="w-2.5 h-2.5 text-white" />
                                </button>
                            </div>
                        ))}
                    </div>
                )}

                <div className="px-4 pt-3 pb-1">
                    <textarea
                        ref={textareaRef}
                        value={input}
                        onChange={handleInputChange}
                        onPaste={onPaste}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                            if (e.key === "Escape") setShowFileSearch(false);
                        }}
                        placeholder="Ask anything..."
                        rows={1}
                        className="w-full bg-transparent text-[14px] text-[var(--color-text-secondary)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:ring-0 focus:shadow-none leading-relaxed overflow-hidden"
                        style={{ minHeight: "1.75rem", maxHeight: "200px", outline: "none", boxShadow: "none" }}
                    />
                </div>

                <div className="flex items-center justify-between px-4 pb-2.5 pt-0.5 select-none">
                    <div className="flex items-center gap-2 text-[var(--color-text-muted)] text-[10px]">
                        <button
                            onClick={handleAddAttachment}
                            className="p-1 hover:text-[var(--color-text-secondary)] hover:bg-white/5 rounded transition-colors"
                            title="Attach file"
                        >
                            <Paperclip className="w-3.5 h-3.5" />
                        </button>
                        <div className="p-0.5 bg-[var(--color-surface-overlay)] rounded border border-[var(--color-border-subtle)]">
                            <CornerDownLeft className="w-3 h-3" />
                        </div>
                        <span>to send</span>
                    </div>

                    <div className="flex items-center gap-2">
                        <div className="relative" ref={presetMenuRef as React.RefObject<HTMLDivElement>}>
                            <button
                                onClick={() => {
                                    if (providerPresetsEnabled) {
                                        setShowPresetMenu(!showPresetMenu);
                                        setShowModelMenu(false);
                                    } else {
                                        setShowModelMenu(!showModelMenu);
                                    }
                                }}
                                className="flex items-center gap-1 text-[9px] font-bold text-[var(--color-text-muted)] tracking-tighter uppercase hover:text-[var(--color-text-tertiary)] transition-colors cursor-pointer"
                                title={providerPresetsEnabled ? "Select preset and model" : "Select model"}
                                disabled={providerPresetsEnabled ? providerPresets.length === 0 : aiModels.length === 0}
                            >
                                <span>{providerPresetsEnabled ? `${activePresetName} / ${activeModelName}` : activeModelName}</span>
                                <ChevronDown className={`w-3 h-3 transition-transform ${showPresetMenu || showModelMenu ? "rotate-180" : ""}`} />
                            </button>
                            {((providerPresetsEnabled && showPresetMenu) || (!providerPresetsEnabled && showModelMenu)) && (
                                <div className={`absolute right-0 w-60 max-h-64 overflow-y-auto bg-[var(--color-surface-overlay)] border border-[var(--color-border-default)] rounded-xl shadow-xl z-50 ${dockedBottom ? "bottom-full mb-2" : "top-full mt-2"}`}>
                                    {providerPresetsEnabled && !showModelMenu && providerPresets.map((preset) => (
                                        <button
                                            key={preset.id}
                                            onClick={() => {
                                                setSelectedProviderPresetId(preset.id);
                                                setShowPresetMenu(true);
                                                setShowModelMenu(true);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)] last:border-b-0 ${preset.id === activePresetId ? "text-[var(--color-accent-primary)]" : "text-[var(--color-text-secondary)]"}`}
                                        >
                                            <div className="truncate font-medium">
                                                {preset.name || "Unnamed preset"}
                                            </div>
                                            <div className="text-[10px] text-[var(--color-text-muted)] truncate">
                                                {preset.providerType === "codex_subscription" ? "ChatGPT OAuth (Codex)" : preset.baseUrl}
                                            </div>
                                        </button>
                                    ))}
                                    {providerPresetsEnabled && showModelMenu && (
                                        <>
                                            <button
                                                onClick={() => setShowModelMenu(false)}
                                                className="w-full text-left px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-[var(--color-text-muted)] hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)]"
                                            >
                                                ← Back To Presets
                                            </button>
                                            <div className="px-3 py-2 text-[10px] uppercase tracking-widest text-[var(--color-text-muted)] border-b border-[var(--color-border-subtle)]">
                                                {activePresetName}
                                            </div>
                                            {aiModels.map((model, index) => (
                                                <button
                                                    key={`${model.id}-${index}`}
                                                    onClick={() => {
                                                        if (activePresetId) {
                                                            setPresetSelectedModelId(activePresetId, model.id);
                                                        }
                                                        setShowPresetMenu(false);
                                                        setShowModelMenu(false);
                                                    }}
                                                    className={`w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)] last:border-b-0 ${model.id === activeModelId ? "text-[var(--color-accent-primary)]" : "text-[var(--color-text-secondary)]"}`}
                                                >
                                                    <div className="truncate font-medium">
                                                        {model.name || model.id || "Unnamed model"}
                                                    </div>
                                                    <div className="text-[10px] text-[var(--color-text-muted)] truncate">{model.id}</div>
                                                </button>
                                            ))}
                                        </>
                                    )}
                                    {!providerPresetsEnabled && aiModels.map((model, index) => (
                                        <button
                                            key={`${model.id}-${index}`}
                                            onClick={() => {
                                                setSelectedModelId(model.id);
                                                setShowModelMenu(false);
                                            }}
                                            className={`w-full text-left px-3 py-2 text-xs hover:bg-[var(--color-void-700)] border-b border-[var(--color-border-subtle)] last:border-b-0 ${model.id === activeModelId ? "text-[var(--color-accent-primary)]" : "text-[var(--color-text-secondary)]"}`}
                                        >
                                            <div className="truncate font-medium">
                                                {model.name || model.id || "Unnamed model"}
                                            </div>
                                            <div className="text-[10px] text-[var(--color-text-muted)] truncate">{model.id}</div>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        {isStreaming ? (
                            <button
                                onClick={handleStop}
                                className="flex items-center gap-1 bg-[var(--color-accent-error)]/10 px-2 py-0.5 rounded border border-[var(--color-accent-error)]/20 text-[var(--color-accent-error)] text-[9px] hover:bg-[var(--color-accent-error)]/20 transition-colors"
                            >
                                <StopCircle className="w-2.5 h-2.5" />
                                <span>Stop</span>
                            </button>
                        ) : (
                            <button
                                onClick={handleSend}
                                className="flex items-center gap-1 bg-[var(--color-surface-overlay)] px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:border-[var(--color-border-default)] transition-colors"
                            >
                                <span className="text-[9px]">^</span>
                                <CornerDownLeft className="w-2.5 h-2.5" />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function ContextPills() {
    const contextPaths = useChatStore(selectCurrentContextPaths);
    const removeContextPath = useChatStore((state) => state.removeContextPath);
    if (contextPaths.length === 0) return null;

    return (
        <div className="flex flex-wrap gap-1.5 px-3 py-2 max-h-24 overflow-y-auto">
            {contextPaths.map(path => (
                <div key={path} className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--color-surface-overlay)] border border-[var(--color-border-subtle)] text-[10px] text-[var(--color-text-tertiary)] group hover:border-[var(--color-accent-primary)]/30 transition-all">
                    <FileIcon className="w-3 h-3 text-[var(--color-accent-primary)]/50" />
                    <span className="truncate max-w-[150px]">{path.split(/[/\\]/).pop()}</span>
                    <button onClick={() => removeContextPath(path)} className="opacity-0 group-hover:opacity-100 hover:text-[var(--color-accent-error)] transition-opacity">
                        <X className="w-2.5 h-2.5" />
                    </button>
                </div>
            ))}
        </div>
    );
}

function ReasoningBlock({ text, innerTools }: { text: string; innerTools?: import("@/stores/chatStore").ReasoningInnerTool[] }) {
    const [expanded, setExpanded] = useState(false);
    const hasTools = innerTools && innerTools.length > 0;
    return (
        <div className="my-2">
            <button
                onClick={() => setExpanded(!expanded)}
                className="flex items-center gap-1.5 text-[11px] font-mono uppercase tracking-widest text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] transition-colors"
            >
                <span className={`transition-transform duration-150 ${expanded ? "rotate-90" : ""}`}>▸</span>
                <span>Thinking</span>
                {hasTools && <span className="text-[9px] opacity-50">· {innerTools!.length} tool{innerTools!.length !== 1 ? "s" : ""}</span>}
                <span className="text-[9px] opacity-50">({text.length} chars)</span>
            </button>
            {expanded && (
                <div className="mt-1.5 ml-1 pl-3 border-l border-[var(--color-border-subtle)] space-y-2">
                    {text && (
                        <div className="text-[12px] text-[var(--color-text-muted)] leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto" style={{ fontFamily: "var(--font-sans)" }}>
                            {text}
                        </div>
                    )}
                    {hasTools && (
                        <ToolOperationDisplay operations={innerTools!.map((t) => t.toolOperation)} />
                    )}
                </div>
            )}
        </div>
    );
}

const MarkdownContent = memo(function MarkdownContent({ content }: { content: string }) {
    return (
        <div className="prose prose-invert prose-sm max-w-none prose-p:leading-relaxed prose-code:text-[var(--color-accent-primary)] prose-code:bg-[var(--color-accent-primary)]/10 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-none prose-pre:bg-transparent prose-pre:p-0" style={{ fontFamily: "var(--font-sans)" }}>
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
});

function ToolOperationLine({ op }: { op: ToolOperation }) {
    const [expanded, setExpanded] = useState(false);
    const isActive = op.status === "started";
    const basename = op.target.split(/[/\\]/).pop() ?? op.target;
    const hasDetails = op.details && op.details.trim() !== "";

    return (
        <div className="group/tool">
            <div
                className={`flex items-center gap-1 text-[12px] font-mono leading-6 select-none ${hasDetails ? "cursor-pointer" : ""}`}
                onClick={() => hasDetails && setExpanded(!expanded)}
                title={op.target}
            >
                <span className={isActive ? "tool-op-shimmer" : "text-[var(--color-text-tertiary)]"}>
                    {op.operation}
                </span>
                <code className="text-[11px] px-1 py-[1px] rounded-sm bg-white/5 text-[#ff3366]/70 font-mono">
                    {basename}
                </code>
                {hasDetails && (
                    <span
                        className={`ml-auto text-[var(--color-text-muted)] opacity-0 group-hover/tool:opacity-100 transition-all duration-150 text-[10px] ${expanded ? "rotate-90" : ""}`}
                        style={{ display: "inline-block", transformOrigin: "center" }}
                    >
                        ▸
                    </span>
                )}
            </div>
            {expanded && hasDetails && (
                <pre className="mt-1 mb-2 ml-1 pl-3 border-l border-[var(--color-border-subtle)] whitespace-pre-wrap font-mono text-[10px] text-[var(--color-text-muted)] leading-relaxed max-h-60 overflow-y-auto">
                    {op.details}
                </pre>
            )}
        </div>
    );
}

const ToolOperationDisplay = memo(function ToolOperationDisplay({ operations }: { operations: ToolOperation[] }) {
    if (!operations || operations.length === 0) return null;

    return (
        <div className="my-1 space-y-0.5">
            {operations.map((op, i) => (
                <ToolOperationLine key={`${op.operation}-${op.target}-${i}`} op={op} />
            ))}
        </div>
    );
});

function DebugPanel({ debugLogs, clearDebugLogs }: { debugLogs: { timestamp: number; type: string; message: string }[]; clearDebugLogs: () => void }) {
    const [testOutput, setTestOutput] = useState<string>("");
    const [testLoading, setTestLoading] = useState(false);
    const { providerType, apiKey, baseUrl, selectedModelId, aiModels } = useSettingsStore(useShallow(selectActiveAISettings));
    const rawStreamLoggingEnabled = useSettingsStore((state) => state.rawStreamLoggingEnabled);
    const setRawStreamLoggingEnabled = useSettingsStore((state) => state.setRawStreamLoggingEnabled);
    const modelId = selectedModelId || aiModels[0]?.id || "gpt-4o";
    const visibleLogs = debugLogs.slice(-250);
    const logCounts = visibleLogs.reduce<Record<string, number>>((acc, log) => {
        acc[log.type] = (acc[log.type] || 0) + 1;
        return acc;
    }, {});

    const colorForLogType = (type: string) => {
        if (type === "error") return "text-red-400";
        if (type === "retry") return "text-amber-300";
        if (type === "attachment") return "text-cyan-300";
        if (type === "backend") return "text-violet-300";
        if (type === "stream") return "text-sky-300";
        if (type === "success") return "text-emerald-300";
        if (type === "warn") return "text-yellow-300";
        if (type === "raw") return "text-fuchsia-300";
        return "text-[var(--color-text-secondary)]";
    };

    const runToolCallTest = async () => {
        setTestLoading(true);
        setTestOutput("Running tool call test...\n");
        try {
            const result = await invoke<string>("debug_tool_call", {
                providerType,
                apiKey,
                baseUrl,
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
                providerType,
                apiKey,
                baseUrl,
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
                providerType,
                apiKey,
                baseUrl,
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

                <div className="mb-3 flex flex-wrap gap-1.5 text-[9px] uppercase tracking-widest text-[var(--color-text-tertiary)]">
                    <span className="px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)]">
                        {visibleLogs.length} logs
                    </span>
                    {Object.entries(logCounts).map(([type, count]) => (
                        <span key={type} className={`px-1.5 py-0.5 rounded border border-[var(--color-border-subtle)] ${colorForLogType(type)}`}>
                            {type}: {count}
                        </span>
                    ))}
                </div>

            {testOutput && (
                <div className="mb-3 p-2 bg-black rounded max-h-60 overflow-y-auto">
                    <pre className="text-[9px] font-mono whitespace-pre-wrap text-green-400">{testOutput}</pre>
                </div>
            )}

                {visibleLogs.length === 0 && !testOutput ? (
                <div className="opacity-50">No debug events yet. Click "Test Tool Call" to debug API.</div>
            ) : (
                    <div className="space-y-1 max-h-72 overflow-y-auto rounded border border-[var(--color-border-subtle)] bg-black/30 p-2">
                        {visibleLogs.map((log, index) => (
                            <div key={`${log.timestamp}-${index}`} className="flex items-start gap-2 font-mono text-[9px] leading-relaxed">
                                <span className="opacity-50 shrink-0">{new Date(log.timestamp).toLocaleTimeString()}</span>
                                <span className={`uppercase tracking-widest shrink-0 ${colorForLogType(log.type)}`}>
                                {log.type}
                            </span>
                                <span className="text-[var(--color-text-primary)] whitespace-pre-wrap break-words">{log.message}</span>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
