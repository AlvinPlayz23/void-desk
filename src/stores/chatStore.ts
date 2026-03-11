import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ToolOperation {
    operation: string;
    target: string;
    status: "started" | "completed" | "failed";
    details?: string;
}

export type MessagePart =
    | { type: "text"; text: string }
    | { type: "tool"; id: string; toolOperation: ToolOperation };

export interface Message {
    role: "user" | "assistant";
    content: string;
    tool_call?: string;
    toolOperations?: ToolOperation[];
    parts: MessagePart[];
    timestamp: number;
}

const getToolPartId = (op: ToolOperation) =>
    `${op.operation}:${op.target}`;

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
        parts.push({ type: "tool", id: getToolPartId(op), toolOperation: op });
    }
    if (message.content) {
        parts.push({ type: "text", text: message.content });
    }
    return { ...message, parts, content: message.content ?? deriveContentFromParts(parts) };
};

export interface DebugLog {
    timestamp: number;
    type: "info" | "error" | "tool" | "retry" | "raw";
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
    addToolOperation: (operation: ToolOperation) => void;
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

            addToolOperation: (operation) => {
                set((state) => {
                    const current = state.currentSession();
                    if (!current || current.messages.length === 0) return state;

                    const lastIndex = current.messages.length - 1;
                    const newMessages = [...current.messages];
                    const lastMsg = newMessages[lastIndex];

                    // Update legacy toolOperations array
                    const ops = [...(lastMsg.toolOperations || [])];
                    const existingIdx = ops.findIndex(
                        (op) => op.operation === operation.operation && op.target === operation.target
                    );
                    if (existingIdx !== -1) {
                        ops[existingIdx] = { ...ops[existingIdx], ...operation };
                    } else {
                        ops.push(operation);
                    }

                    // Update parts array
                    const toolId = getToolPartId(operation);
                    const parts = [...lastMsg.parts];
                    const existingPartIdx = parts.findIndex(
                        (p) => p.type === "tool" && p.id === toolId
                    );
                    if (existingPartIdx !== -1) {
                        const existingPart = parts[existingPartIdx];
                        if (existingPart.type === "tool") {
                            parts[existingPartIdx] = {
                                type: "tool",
                                id: toolId,
                                toolOperation: { ...existingPart.toolOperation, ...operation },
                            };
                        }
                    } else {
                        parts.push({ type: "tool", id: toolId, toolOperation: operation });
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

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, debugLogs: [...s.debugLogs, log], lastUpdated: Date.now() }
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
            version: 2,
            migrate: (persistedState: any, _version: number) => {
                if (!persistedState?.sessions) return persistedState;
                return {
                    ...persistedState,
                    sessions: persistedState.sessions.map((session: any) => ({
                        ...session,
                        messages: (session.messages ?? []).map(normalizeMessage),
                    })),
                };
            },
        }
    )
);
