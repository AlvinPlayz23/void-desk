import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface ToolOperation {
    operation: string;
    target: string;
    status: "started" | "completed" | "failed";
}

export interface Message {
    role: "user" | "assistant";
    content: string;
    tool_call?: string;
    toolOperations?: ToolOperation[];
    timestamp: number;
}

export interface ChatSession {
    id: string;
    name: string;
    messages: Message[];
    contextPaths: string[];
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

    // Session management
    createSession: (name: string) => string;
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

            createSession: (name: string) => {
                const id = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                const newSession: ChatSession = {
                    id,
                    name,
                    messages: [],
                    contextPaths: [],
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
                set((state) => {
                    const current = state.currentSession();
                    if (!current) return state;

                    return {
                        sessions: state.sessions.map((s) =>
                            s.id === current.id
                                ? { ...s, messages: [...s.messages, message], lastUpdated: Date.now() }
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
                    newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        content: newMessages[lastIndex].content + text,
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
                    const ops = [...(newMessages[lastIndex].toolOperations || [])];

                    const existingIdx = ops.findIndex(
                        (op) => op.operation === operation.operation && op.target === operation.target
                    );

                    if (existingIdx !== -1) {
                        ops[existingIdx] = { ...ops[existingIdx], ...operation };
                    } else {
                        ops.push(operation);
                    }

                    newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        toolOperations: ops,
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
        }
    )
);
