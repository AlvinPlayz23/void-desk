import { create } from "zustand";

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
    id: string;
    role: "user" | "assistant";
    content: string;
    tool_call?: string;
    toolOperations?: ToolOperation[];
    parts: MessagePart[];
    attachments?: ChatAttachment[];
    timestamp: number;
}

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

export interface PersistedChatState {
    sessions: ChatSession[];
    activeSessionId: string | null;
}

const EMPTY_MESSAGES: Message[] = [];
const EMPTY_CONTEXT_PATHS: string[] = [];
const EMPTY_DEBUG_LOGS: DebugLog[] = [];

interface ChatState {
    sessions: ChatSession[];
    activeSessionId: string | null;
    isHydrated: boolean;

    currentSession: () => ChatSession | null;
    currentMessages: () => Message[];
    currentContextPaths: () => string[];
    currentDebugLogs: () => DebugLog[];

    createSession: (name: string, workspacePath?: string | null) => string;
    deleteSession: (id: string) => void;
    switchSession: (id: string) => void;
    renameSession: (id: string, name: string) => void;
    replaceState: (state: PersistedChatState) => void;
    setHydrated: (hydrated: boolean) => void;

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

    addContextPath: (path: string) => void;
    removeContextPath: (path: string) => void;
    clearContextPaths: () => void;
}

let toolPartCounter = 0;
let messageCounter = 0;

const generateToolPartId = () => `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}-${toolPartCounter++}`;
const generateMessageId = () => `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${messageCounter++}`;

const deriveContentFromParts = (parts: MessagePart[]) =>
    parts
        .filter((part): part is Extract<MessagePart, { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("");

const normalizeMessage = (message: any): Message => {
    if (Array.isArray(message.parts) && message.parts.length > 0) {
        return {
            ...(message as Message),
            id: message.id ?? generateMessageId(),
            parts: message.parts,
            content: message.content ?? deriveContentFromParts(message.parts),
        };
    }

    const parts: MessagePart[] = [];
    for (const operation of message.toolOperations ?? []) {
        parts.push({ type: "tool", id: generateToolPartId(), toolOperation: operation });
    }
    if (message.content) {
        parts.push({ type: "text", text: message.content });
    }

    return {
        ...message,
        id: message.id ?? generateMessageId(),
        parts,
        content: message.content ?? deriveContentFromParts(parts),
    };
};

const stripPersistedAttachments = (message: Message): Message => ({
    ...normalizeMessage(message),
    attachments: undefined,
});

const sanitizeSession = (session: ChatSession): ChatSession => ({
    ...session,
    messages: (session.messages ?? []).map(stripPersistedAttachments),
    debugLogs: session.debugLogs ?? [],
    contextPaths: session.contextPaths ?? [],
    workspacePath: session.workspacePath ?? null,
});

const sanitizeState = (state: PersistedChatState): PersistedChatState => {
    const sessions = (state.sessions ?? []).map(sanitizeSession);
    const activeSessionId = sessions.find((session) => session.id === state.activeSessionId)
        ? state.activeSessionId
        : (sessions[0]?.id ?? null);

    return {
        sessions,
        activeSessionId,
    };
};

const resolveCurrentSession = (state: Pick<ChatState, "sessions" | "activeSessionId">): ChatSession | null => {
    if (!state.activeSessionId) return null;
    return state.sessions.find((session) => session.id === state.activeSessionId) || null;
};

export const selectCurrentSession = (state: Pick<ChatState, "sessions" | "activeSessionId">) =>
    resolveCurrentSession(state);

export const selectCurrentMessages = (state: Pick<ChatState, "sessions" | "activeSessionId">) =>
    resolveCurrentSession(state)?.messages ?? EMPTY_MESSAGES;

export const selectCurrentContextPaths = (state: Pick<ChatState, "sessions" | "activeSessionId">) =>
    resolveCurrentSession(state)?.contextPaths ?? EMPTY_CONTEXT_PATHS;

export const selectCurrentDebugLogs = (state: Pick<ChatState, "sessions" | "activeSessionId">) =>
    resolveCurrentSession(state)?.debugLogs ?? EMPTY_DEBUG_LOGS;

export const useChatStore = create<ChatState>()((set, get) => ({
    sessions: [],
    activeSessionId: null,
    isHydrated: false,

    currentSession: () => {
        return resolveCurrentSession(get());
    },

    currentMessages: () => {
        const current = get().currentSession();
        return current?.messages ?? EMPTY_MESSAGES;
    },

    currentContextPaths: () => {
        const current = get().currentSession();
        return current?.contextPaths ?? EMPTY_CONTEXT_PATHS;
    },

    currentDebugLogs: () => {
        const current = get().currentSession();
        return current?.debugLogs ?? EMPTY_DEBUG_LOGS;
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
            const sessions = state.sessions.filter((session) => session.id !== id);
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
            activeSessionId: state.sessions.find((session) => session.id === id) ? id : state.activeSessionId,
        }));
    },

    renameSession: (id: string, name: string) => {
        set((state) => ({
            sessions: state.sessions.map((session) => (session.id === id ? { ...session, name } : session)),
        }));
    },

    replaceState: (state) => {
        const sanitized = sanitizeState(state);
        set({
            sessions: sanitized.sessions,
            activeSessionId: sanitized.activeSessionId,
        });
    },

    setHydrated: (hydrated) => set({ isHydrated: hydrated }),

    addMessage: (message: Message) => {
        const normalized = normalizeMessage(message);
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, messages: [...session.messages, normalized], lastUpdated: Date.now() }
                        : session
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
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, messages: newMessages, lastUpdated: Date.now() }
                        : session
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
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, messages: newMessages, lastUpdated: Date.now() }
                        : session
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
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, messages: newMessages, lastUpdated: Date.now() }
                        : session
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

            const operations = [...(lastMsg.toolOperations || [])];
            if (operation.status === "started") {
                operations.push(operation);
            } else {
                let matchIndex = -1;
                for (let i = operations.length - 1; i >= 0; i--) {
                    if (operations[i].target === operation.target && operations[i].status === "started") {
                        matchIndex = i;
                        break;
                    }
                }

                if (matchIndex !== -1) {
                    operations[matchIndex] = { ...operations[matchIndex], ...operation };
                } else {
                    operations.push(operation);
                }
            }

            const parts = [...lastMsg.parts];
            if (operation.status === "started") {
                parts.push({ type: "tool", id: generateToolPartId(), toolOperation: operation });
            } else {
                let matchPartIndex = -1;
                for (let i = parts.length - 1; i >= 0; i--) {
                    const part = parts[i];
                    if (part.type === "tool" && part.toolOperation.target === operation.target && part.toolOperation.status === "started") {
                        matchPartIndex = i;
                        break;
                    }
                }

                if (matchPartIndex !== -1) {
                    const existingPart = parts[matchPartIndex];
                    if (existingPart.type === "tool") {
                        parts[matchPartIndex] = {
                            type: "tool",
                            id: existingPart.id,
                            toolOperation: { ...existingPart.toolOperation, ...operation },
                        };
                    }
                } else {
                    parts.push({ type: "tool", id: generateToolPartId(), toolOperation: operation });
                }
            }

            newMessages[lastIndex] = {
                ...lastMsg,
                toolOperations: operations,
                parts,
            };

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, messages: newMessages, lastUpdated: Date.now() }
                        : session
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

            let reasoningIndex = -1;
            for (let i = parts.length - 1; i >= 0; i--) {
                if (parts[i].type === "reasoning") {
                    reasoningIndex = i;
                    break;
                }
            }
            if (reasoningIndex === -1) return state;

            const reasoningPart = parts[reasoningIndex];
            if (reasoningPart.type !== "reasoning") return state;
            const innerTools = [...(reasoningPart.innerTools ?? [])];

            if (operation.status === "started") {
                innerTools.push({ id: generateToolPartId(), toolOperation: operation });
            } else {
                let matchIndex = -1;
                for (let i = innerTools.length - 1; i >= 0; i--) {
                    if (innerTools[i].toolOperation.target === operation.target && innerTools[i].toolOperation.status === "started") {
                        matchIndex = i;
                        break;
                    }
                }

                if (matchIndex !== -1) {
                    innerTools[matchIndex] = {
                        ...innerTools[matchIndex],
                        toolOperation: { ...innerTools[matchIndex].toolOperation, ...operation },
                    };
                } else {
                    innerTools.push({ id: generateToolPartId(), toolOperation: operation });
                }
            }

            parts[reasoningIndex] = { ...reasoningPart, innerTools };
            newMessages[lastIndex] = { ...lastMsg, parts };

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, messages: newMessages, lastUpdated: Date.now() }
                        : session
                ),
            };
        });
    },

    removeLastMessage: () => {
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id ? { ...session, messages: session.messages.slice(0, -1) } : session
                ),
            };
        });
    },

    clearCurrentMessages: () => {
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id ? { ...session, messages: [] } : session
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
                sessions: state.sessions.map((session) =>
                    session.id === current.id
                        ? { ...session, debugLogs: nextDebugLogs, lastUpdated: Date.now() }
                        : session
                ),
            };
        });
    },

    clearDebugLogs: () => {
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id ? { ...session, debugLogs: [] } : session
                ),
            };
        });
    },

    addContextPath: (path: string) => {
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            const contextPaths = current.contextPaths.includes(path)
                ? current.contextPaths
                : [...current.contextPaths, path];

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id ? { ...session, contextPaths } : session
                ),
            };
        });
    },

    removeContextPath: (path: string) => {
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            const contextPaths = current.contextPaths.filter((currentPath) => currentPath !== path);

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id ? { ...session, contextPaths } : session
                ),
            };
        });
    },

    clearContextPaths: () => {
        set((state) => {
            const current = state.currentSession();
            if (!current) return state;

            return {
                sessions: state.sessions.map((session) =>
                    session.id === current.id ? { ...session, contextPaths: [] } : session
                ),
            };
        });
    },
}));
