import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ToolOperation {
    operation: string;
    target: string;
    status: "started" | "completed" | "failed";
    details?: string;
}

export type ReasoningInnerTool = { id: string; toolOperation: ToolOperation };

export type MessagePart =
    | { type: "text"; text: string }
    | { type: "tool"; id: string; toolOperation: ToolOperation }
    | { type: "reasoning"; text: string; innerTools?: ReasoningInnerTool[] };

export type ChatAttachment =
    | {
        id: string;
        kind: "text";
        name: string;
        mimeType: string;
        textContent: string;
        preparedForModelId?: string;
    }
    | {
        id: string;
        kind: "image";
        name: string;
        mimeType: string;
        dataUrl: string;
        preparedForModelId?: string;
    };

export interface Message {
    role: "user" | "assistant";
    content: string;
    tool_call?: string;
    toolOperations?: ToolOperation[];
    parts: MessagePart[];
    attachments?: ChatAttachment[];
    timestamp: number;
}

let toolPartCounter = 0;
const generateToolPartId = () => `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${toolPartCounter++}`;

const deriveContentFromParts = (parts: MessagePart[]) =>
    parts
        .filter((p): p is Extract<MessagePart, { type: "text" }> => p.type === "text")
        .map((p) => p.text)
        .join("");

const normalizeMessage = (message: any): Message => {
    if (Array.isArray(message.parts) && message.parts.length > 0) {
        return message as Message;
    }
    const parts: MessagePart[] = [];
    for (const op of message.toolOperations ?? []) {
        parts.push({ type: "tool", id: generateToolPartId(), toolOperation: op });
    }
    if (message.content) {
        parts.push({ type: "text", text: message.content });
    }
    return { ...message, parts, content: message.content ?? deriveContentFromParts(parts) };
};

// Avoid persisting attachment payloads (text blobs / base64 images) into localStorage.
// They stay available in-memory for the active chat session, but skipping them in
// persisted state prevents large synchronous writes on every streaming update.
const stripPersistedAttachments = (message: Message): Message => ({
    ...normalizeMessage(message),
    attachments: undefined,
});

const stripPersistedSessions = (sessions: ChatSession[]): ChatSession[] =>
    sessions.map((session) => ({
        ...session,
        messages: session.messages.map(stripPersistedAttachments),
    }));

export interface DebugLog {
    timestamp: number;
    type: string;
    message: string;
}

export interface ChatSession {
    id: string;
    name: string;
    messages: Message[];
    contextPaths: string[];
    workspacePath: string | null;
    debugLogs: DebugLog[];
    createdAt: number;
    lastUpdated: number;
}

interface ChatState {
    sessions: ChatSession[];
    activeSessionId: string | null;

    // Current session helpers
    currentSession: () => ChatSession | null;
    currentMessages: () => Message[];
    currentContextPaths: () => string[];
    currentDebugLogs: () => DebugLog[];

    // Session management
    createSession: (name: string, workspacePath?: string | null) => string;
    deleteSession: (id: string) => void;
    switchSession: (id: string) => void;
    renameSession: (id: string, name: string) => void;

    // Message management
    addMessage: (message: Message) => void;
    updateLastMessage: (updates: Partial<Message>) => void;
    appendToLastMessage: (text: string) => void;
    appendReasoningToLastMessage: (text: string) => void;
    addToolOperation: (operation: ToolOperation) => void;
    addToolOperationToLastReasoning: (operation: ToolOperation) => void;
    removeLastMessage: () => void;
    clearCurrentMessages: () => void;
    addDebugLog: (log: DebugLog) => void;
    clearDebugLogs: () => void;

    // Context management
    addContextPath: (path: string) => void;
    removeContextPath: (path: string) => void;
    clearContextPaths: () => void;
}

export const useChatStore = create<ChatState>()(
    persist(
        (set, get) => ({
            sessions: [],
            activeSessionId: null,

            currentSession: () => {
                const state = get();
                if (!state.activeSessionId) return null;
                return state.sessions.find((s) => s.id === state.activeSessionId) || null;
            },

            currentMessages: () => {
                const current = get().currentSession();
                return current?.messages || [];
            },

            currentContextPaths: () => {
                const current = get().currentSession();
                return current?.contextPaths || [];
            },

            currentDebugLogs: () => {
                const current = get().currentSession();
                return current?.debugLogs || [];
            },

            createSession: (name: string, workspacePath?: string | null) => {
                const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const newSession: ChatSession = {
                    id,
                    name,
                    messages: [],
                    contextPaths: [],
                    workspacePath: workspacePath ?? null,
                    debugLogs: [],
                    createdAt: Date.now(),
                    lastUpdated: Date.now(),
                };

                set((state) => ({
                    sessions: [...state.sessions, newSession],
                    activeSessionId: id,
                }));

                return id;
            },

            deleteSession: (id: string) => {
                set((state) => {
                    const sessions = state.sessions.filter((s) => s.id !== id);
                    const activeSessionId =
                        state.activeSessionId === id ? (sessions[0]?.id || null) : state.activeSessionId;

                    return {
                        sessions,
                        activeSessionId,
                    };
                });
            },

            switchSession: (id: string) => {
                set((state) => ({
                    activeSessionId: state.sessions.find((s) => s.id === id) ? id : state.activeSessionId,
                }));
            },

            renameSession: (id: string, name: string) => {
                set((state) => ({
                    sessions: state.sessions.map((s) => (s.id === id ? { ...s, name } : s)),
                }));
            },

            addMessage: (message: Message) => {
                const normalized = normalizeMessage(message);
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, messages: [...s.messages, normalized], lastUpdated: Date.now() }
                                : s
                        ),
                    };
                });
            },

            updateLastMessage: (updates) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current || current.messages.length === 0) return state;

                    const lastIndex = current.messages.length - 1;
                    const newMessages = [...current.messages];
                    newMessages[lastIndex] = { ...newMessages[lastIndex], ...updates };

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, messages: newMessages, lastUpdated: Date.now() }
                                : s
                        ),
                    };
                });
            },

            appendToLastMessage: (text) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current || current.messages.length === 0) return state;

                    const lastIndex = current.messages.length - 1;
                    const newMessages = [...current.messages];
                    const lastMsg = newMessages[lastIndex];
                    const parts = [...lastMsg.parts];
                    const lastPart = parts[parts.length - 1];

                    if (lastPart && lastPart.type === "text") {
                        parts[parts.length - 1] = { type: "text", text: lastPart.text + text };
                    } else {
                        parts.push({ type: "text", text });
                    }

                    newMessages[lastIndex] = {
                        ...lastMsg,
                        parts,
                        content: lastMsg.content + text,
                    };

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, messages: newMessages, lastUpdated: Date.now() }
                                : s
                        ),
                    };
                });
            },

            appendReasoningToLastMessage: (text) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current || current.messages.length === 0) return state;

                    const lastIndex = current.messages.length - 1;
                    const newMessages = [...current.messages];
                    const lastMsg = newMessages[lastIndex];
                    const parts = [...lastMsg.parts];
                    const lastPart = parts[parts.length - 1];

                    if (lastPart && lastPart.type === "reasoning") {
                        parts[parts.length - 1] = { type: "reasoning", text: lastPart.text + text };
                    } else {
                        parts.push({ type: "reasoning", text });
                    }

                    newMessages[lastIndex] = {
                        ...lastMsg,
                        parts,
                    };

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, messages: newMessages, lastUpdated: Date.now() }
                                : s
                        ),
                    };
                });
            },

            addToolOperation: (operation) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current || current.messages.length === 0) return state;

                    const lastIndex = current.messages.length - 1;
                    const newMessages = [...current.messages];
                    const lastMsg = newMessages[lastIndex];

                    // Update legacy toolOperations array
                    const ops = [...(lastMsg.toolOperations || [])];
                    if (operation.status === "started") {
                        ops.push(operation);
                    } else {
                        // Find the LAST started op with the same target
                        let matchIdx = -1;
                        for (let i = ops.length - 1; i >= 0; i--) {
                            if (ops[i].target === operation.target && ops[i].status === "started") {
                                matchIdx = i;
                                break;
                            }
                        }
                        if (matchIdx !== -1) {
                            ops[matchIdx] = { ...ops[matchIdx], ...operation };
                        } else {
                            ops.push(operation);
                        }
                    }

                    // Update parts array
                    const parts = [...lastMsg.parts];
                    if (operation.status === "started") {
                        const toolId = generateToolPartId();
                        parts.push({ type: "tool", id: toolId, toolOperation: operation });
                    } else {
                        // Find the LAST started tool part with the same target
                        let matchPartIdx = -1;
                        for (let i = parts.length - 1; i >= 0; i--) {
                            const p = parts[i];
                            if (p.type === "tool" && p.toolOperation.target === operation.target && p.toolOperation.status === "started") {
                                matchPartIdx = i;
                                break;
                            }
                        }
                        if (matchPartIdx !== -1) {
                            const existingPart = parts[matchPartIdx];
                            if (existingPart.type === "tool") {
                                parts[matchPartIdx] = {
                                    type: "tool",
                                    id: existingPart.id,
                                    toolOperation: { ...existingPart.toolOperation, ...operation },
                                };
                            }
                        } else {
                            const toolId = generateToolPartId();
                            parts.push({ type: "tool", id: toolId, toolOperation: operation });
                        }
                    }

                    newMessages[lastIndex] = {
                        ...lastMsg,
                        toolOperations: ops,
                        parts,
                    };

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, messages: newMessages, lastUpdated: Date.now() }
                                : s
                        ),
                    };
                });
            },

            addToolOperationToLastReasoning: (operation) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current || current.messages.length === 0) return state;

                    const lastIndex = current.messages.length - 1;
                    const newMessages = [...current.messages];
                    const lastMsg = newMessages[lastIndex];
                    const parts = [...lastMsg.parts];

                    let reasoningIdx = -1;
                    for (let i = parts.length - 1; i >= 0; i--) {
                        if (parts[i].type === "reasoning") { reasoningIdx = i; break; }
                    }
                    if (reasoningIdx === -1) return state;

                    const rp = parts[reasoningIdx];
                    if (rp.type !== "reasoning") return state;
                    const innerTools = [...(rp.innerTools ?? [])];

                    if (operation.status === "started") {
                        innerTools.push({ id: generateToolPartId(), toolOperation: operation });
                    } else {
                        let matchIdx = -1;
                        for (let i = innerTools.length - 1; i >= 0; i--) {
                            if (innerTools[i].toolOperation.target === operation.target && innerTools[i].toolOperation.status === "started") {
                                matchIdx = i; break;
                            }
                        }
                        if (matchIdx !== -1) {
                            innerTools[matchIdx] = { ...innerTools[matchIdx], toolOperation: { ...innerTools[matchIdx].toolOperation, ...operation } };
                        } else {
                            innerTools.push({ id: generateToolPartId(), toolOperation: operation });
                        }
                    }

                    parts[reasoningIdx] = { ...rp, innerTools };
                    newMessages[lastIndex] = { ...lastMsg, parts };
                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, messages: newMessages, lastUpdated: Date.now() } : s
                        ),
                    };
                });
            },

            removeLastMessage: () => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, messages: s.messages.slice(0, -1) } : s
                        ),
                    };
                });
            },

            clearCurrentMessages: () => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, messages: [] } : s
                        ),
                    };
                });
            },

            addDebugLog: (log) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    const nextDebugLogs = [...current.debugLogs, log].slice(-500);

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, debugLogs: nextDebugLogs, lastUpdated: Date.now() }
                                : s
                        ),
                    };
                });
            },

            clearDebugLogs: () => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, debugLogs: [] } : s
                        ),
                    };
                });
            },

            addContextPath: (path: string) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    const paths = current.contextPaths.includes(path)
                        ? current.contextPaths
                        : [...current.contextPaths, path];

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, contextPaths: paths } : s
                        ),
                    };
                });
            },

            removeContextPath: (path: string) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    const paths = current.contextPaths.filter((p) => p !== path);

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, contextPaths: paths } : s
                        ),
                    };
                });
            },

            clearContextPaths: () => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id ? { ...s, contextPaths: [] } : s
                        ),
                    };
                });
            },
        }),
        {
            name: "voiddesk-chat-sessions",
            version: 4,
            partialize: (state) => ({
                sessions: stripPersistedSessions(state.sessions),
                activeSessionId: state.activeSessionId,
            }),
            migrate: (persistedState: any, _version: number) => {
                if (!persistedState?.sessions) return persistedState;
                return {
                    ...persistedState,
                    sessions: stripPersistedSessions(
                        persistedState.sessions.map((session: any) => ({
                            ...session,
                            messages: (session.messages ?? []).map((msg: any) => normalizeMessage(msg)),
                            debugLogs: session.debugLogs ?? [],
                            contextPaths: session.contextPaths ?? [],
                        }))
                    ),
                };
            },
        }
    )
);
