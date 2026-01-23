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

interface ChatState {
    messages: Message[];
    contextPaths: string[];

    // Actions
    addMessage: (message: Message) => void;
    updateLastMessage: (updates: Partial<Message>) => void;
    appendToLastMessage: (text: string) => void;
    addToolOperation: (operation: ToolOperation) => void;
    setMessages: (messages: Message[]) => void;
    removeLastMessage: () => void;
    clearMessages: () => void;

    addContextPath: (path: string) => void;
    removeContextPath: (path: string) => void;
    clearContextPaths: () => void;
}

export const useChatStore = create<ChatState>()(
    persist(
        (set) => ({
            messages: [],
            contextPaths: [],

            addMessage: (message) =>
                set((state) => ({
                    messages: [...state.messages, message],
                })),

            updateLastMessage: (updates) =>
                set((state) => {
                    if (state.messages.length === 0) return state;
                    const lastIndex = state.messages.length - 1;
                    const newMessages = [...state.messages];
                    newMessages[lastIndex] = { ...newMessages[lastIndex], ...updates };
                    return { messages: newMessages };
                }),

            appendToLastMessage: (text) =>
                set((state) => {
                    if (state.messages.length === 0) return state;
                    const lastIndex = state.messages.length - 1;
                    const newMessages = [...state.messages];
                    newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        content: newMessages[lastIndex].content + text,
                    };
                    return { messages: newMessages };
                }),

            addToolOperation: (operation) =>
                set((state) => {
                    if (state.messages.length === 0) return state;
                    const lastIndex = state.messages.length - 1;
                    const newMessages = [...state.messages];
                    const ops = [...(newMessages[lastIndex].toolOperations || [])];

                    // Find if an operation with same operation type AND target exists
                    const existingIdx = ops.findIndex(op =>
                        op.operation === operation.operation &&
                        op.target === operation.target
                    );

                    if (existingIdx !== -1) {
                        // Update existing operation (merge status)
                        ops[existingIdx] = { ...ops[existingIdx], ...operation };
                    } else {
                        // Add new operation
                        ops.push(operation);
                    }

                    newMessages[lastIndex] = {
                        ...newMessages[lastIndex],
                        toolOperations: ops,
                    };
                    return { messages: newMessages };
                }),

            setMessages: (messages) => set({ messages }),

            removeLastMessage: () =>
                set((state) => ({
                    messages: state.messages.slice(0, -1)
                })),

            clearMessages: () => set({ messages: [] }),

            addContextPath: (path) =>
                set((state) => ({
                    contextPaths: state.contextPaths.includes(path)
                        ? state.contextPaths
                        : [...state.contextPaths, path],
                })),

            removeContextPath: (path) =>
                set((state) => ({
                    contextPaths: state.contextPaths.filter((p) => p !== path),
                })),

            clearContextPaths: () => set({ contextPaths: [] }),
        }),
        {
            name: "voiddesk-chat-history",
        }
    )
);
