import { useState, useCallback, useRef } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import { useChatStore, ToolOperation, Message } from "@/stores/chatStore";

export interface AIResponseChunk {
    content?: string;
    tool_call?: string;
    tool_operation?: ToolOperation;
    debug?: string;
    error?: string;
    error_type?: string;
    done: boolean;
}

interface ConversationHistoryMessage {
    role: "user" | "assistant";
    content: string;
}

const serializeConversationHistory = (messages: Message[]): ConversationHistoryMessage[] =>
    messages
        .filter((message): message is Message & { role: "user" | "assistant" } =>
            (message.role === "user" || message.role === "assistant") && message.content.trim().length > 0
        )
        .map((message) => ({ role: message.role, content: message.content }));

export function useAI() {
    const [isStreaming, setIsStreaming] = useState(false);
    const { openAIKey, openAIBaseUrl, selectedModelId, aiModels, rawStreamLoggingEnabled, chatContextWindow } = useSettingsStore();
    const { rootPath } = useFileStore();
    const { refreshFileTree } = useFileSystem();
    const messages = useChatStore((state) => state.currentMessages());
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const { addMessage, appendToLastMessage, addToolOperation, updateLastMessage, addDebugLog } = useChatStore();

    // Store abort flag
    const abortRef = useRef(false);
    const retryAttemptsRef = useRef(0);
    const currentMessageRef = useRef("");
    const pendingRetryRef = useRef(false);
    const activeRequestRef = useRef(0);
    const activeRunIdRef = useRef<string | null>(null);

    const stopStreaming = useCallback(() => {
        abortRef.current = true;
        if (activeRunIdRef.current) {
            invoke<boolean>("cancel_ai_stream", { requestId: activeRunIdRef.current }).catch((err) =>
                console.warn("Failed to cancel stream:", err)
            );
        }
        setIsStreaming(false);
    }, []);

    const sendMessage = useCallback(
        async (text: string, isRetry = false) => {
            if (!text.trim() || isStreaming) return;

            // Reset abort flag
            abortRef.current = false;
            if (!isRetry) {
                retryAttemptsRef.current = 0;
            }
            currentMessageRef.current = text;
            pendingRetryRef.current = false;
            const currentSessionMessages = useChatStore.getState().currentMessages();
            const lastSessionMessage = currentSessionMessages[currentSessionMessages.length - 1];
            const priorMessages = isRetry && lastSessionMessage?.role === "user"
                ? currentSessionMessages.slice(0, -1)
                : currentSessionMessages;
            const historyMessages = serializeConversationHistory(priorMessages);
            const requestId = activeRequestRef.current + 1;
            activeRequestRef.current = requestId;
            const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            activeRunIdRef.current = runId;

            addDebugLog({
                timestamp: Date.now(),
                type: "info",
                message: isRetry ? "Retrying message" : "Sending message",
            });

            if (!isRetry) {
                const userMessage: Message = { role: "user", content: text, parts: [{ type: "text", text }], timestamp: Date.now() };
                addMessage(userMessage);
            }

            const assistantMessage: Message = {
                role: "assistant",
                content: "",
                toolOperations: [],
                parts: [],
                timestamp: Date.now(),
            };
            addMessage(assistantMessage);

            setIsStreaming(true);

            // Get context from attached files
            const contextPaths = useChatStore.getState().currentContextPaths();
            let contextContent = "";

            if (contextPaths.length > 0) {
                const contextParts: string[] = [];
                for (const path of contextPaths) {
                    try {
                        const content = await invoke<string>("read_file", { path });
                        const fileName = path.split(/[/\\]/).pop() || path;
                        contextParts.push(`--- File: ${fileName} ---\n${content}`);
                    } catch (err) {
                        console.warn("Could not read context file:", path, err);
                    }
                }
                if (contextParts.length > 0) {
                    contextContent = "\n\n[Attached Context Files]\n" + contextParts.join("\n\n");
                }
                // Clear context paths after use
                useChatStore.getState().clearContextPaths();
            }

            // Combine user message with context
            const fullMessage = text + contextContent;
            const activeModelId = selectedModelId || aiModels[0]?.id || "gpt-4o";

            try {
                const onEvent = new Channel<AIResponseChunk>();

                onEvent.onmessage = (chunk: AIResponseChunk) => {
                    // Check abort flag
                    if (abortRef.current) {
                        setIsStreaming(false);
                        return;
                    }

                    if (chunk.error) {
                        abortRef.current = true;
                        const current = useChatStore.getState().currentMessages();
                        const lastMessage = current[current.length - 1];
                        const existingContent = lastMessage?.content || "";
                        const errorLabel = chunk.error_type ? `Error (${chunk.error_type}): ` : "Error: ";
                        updateLastMessage({
                            content: existingContent + "\n\n" + errorLabel + chunk.error,
                        });

                        addDebugLog({
                            timestamp: Date.now(),
                            type: "error",
                            message: chunk.error_type ? `${chunk.error_type}: ${chunk.error}` : chunk.error,
                        });

                        const isRateLimitError = chunk.error.includes("Invalid status code: 429");
                        const isUnprocessableEntity = chunk.error.includes("Invalid status code: 422");
                        if (
                            isRateLimitError &&
                            retryAttemptsRef.current < 1 &&
                            !pendingRetryRef.current &&
                            !abortRef.current
                        ) {
                            retryAttemptsRef.current += 1;
                            pendingRetryRef.current = true;
                            addDebugLog({
                                timestamp: Date.now(),
                                type: "retry",
                                message: "Auto-retrying after 429 rate limit",
                            });
                            setIsStreaming(false);
                            setTimeout(() => {
                                if (abortRef.current || activeRequestRef.current !== requestId) return;
                                useChatStore.getState().removeLastMessage();
                                activeRunIdRef.current = null;
                                sendMessage(currentMessageRef.current, true);
                            }, 1200);
                        } else if (isUnprocessableEntity) {
                            addDebugLog({
                                timestamp: Date.now(),
                                type: "error",
                                message: "Request rejected with 422. Try again or reduce context size.",
                            });
                            setIsStreaming(false);
                            pendingRetryRef.current = false;
                            activeRunIdRef.current = null;
                        } else {
                            setIsStreaming(false);
                            pendingRetryRef.current = false;
                            activeRunIdRef.current = null;
                        }
                        return;
                    }

                    if (chunk.content) {
                        appendToLastMessage(chunk.content);
                    }

                    if (chunk.tool_operation) {
                        addToolOperation(chunk.tool_operation);

                        addDebugLog({
                            timestamp: Date.now(),
                            type: "tool",
                            message: `${chunk.tool_operation.operation} ${chunk.tool_operation.target}`,
                        });

                        // Auto-refresh file tree when AI makes changes
                        if (chunk.tool_operation.status === "completed") {
                            const changedOps = ["Writing", "Created", "Edited", "Executed", "Deleted"];
                            if (changedOps.includes(chunk.tool_operation.operation)) {
                                if (rootPath) {
                                    refreshFileTree(rootPath);
                                }
                            }
                        }
                    }

                    if (chunk.tool_call) {
                        // We could log this or show it in dev mode, 
                        // but tool_operation handles visual feedback
                        console.log("Tool call:", chunk.tool_call);

                        addDebugLog({
                            timestamp: Date.now(),
                            type: "info",
                            message: chunk.tool_call,
                        });
                    }

                    if (chunk.debug) {
                        addDebugLog({
                            timestamp: Date.now(),
                            type: "raw",
                            message: chunk.debug,
                        });
                    }

                    if (chunk.done) {
                        setIsStreaming(false);
                        abortRef.current = false;
                        pendingRetryRef.current = false;
                        activeRunIdRef.current = null;

                        addDebugLog({
                            timestamp: Date.now(),
                            type: "info",
                            message: "Stream complete",
                        });
                    }
                };

                // Use session-aware command if session is active
                await invoke("ask_ai_stream_with_session", {
                    sessionId: activeSessionId || "",
                    historyMessages,
                    message: fullMessage,
                    apiKey: openAIKey,
                    baseUrl: openAIBaseUrl,
                    modelId: activeModelId,
                    contextWindowTokens: chatContextWindow,
                    activePath: rootPath,
                    debugRawStream: rawStreamLoggingEnabled,
                    requestId: runId,
                    onEvent,
                });
            } catch (error) {
                console.error("AI Error:", error);
                updateLastMessage({
                    content: "Failed to connect to AI. Please check your settings."
                });
                addDebugLog({
                    timestamp: Date.now(),
                    type: "error",
                    message: `AI Error: ${String(error)}`,
                });
                setIsStreaming(false);
                abortRef.current = false;
                activeRunIdRef.current = null;
            }
        },
        [
            isStreaming,
            activeSessionId,
            openAIKey,
            openAIBaseUrl,
            selectedModelId,
            aiModels,
            chatContextWindow,
            rootPath,
            addMessage,
            appendToLastMessage,
            addToolOperation,
            updateLastMessage,
            addDebugLog,
            rawStreamLoggingEnabled,
        ]
    );

    const retryLastMessage = useCallback(async () => {
        const currentMessages = useChatStore.getState().currentMessages();
        if (currentMessages.length === 0) return;

        if (isStreaming) return;

        // Find last user message
        const lastUserMsgIdx = [...currentMessages].reverse().findIndex(m => m.role === "user");
        if (lastUserMsgIdx === -1) return;

        const actualIdx = currentMessages.length - 1 - lastUserMsgIdx;
        const lastUserContent = currentMessages[actualIdx].content;

        retryAttemptsRef.current = 0;
        pendingRetryRef.current = false;
        abortRef.current = false;

        addDebugLog({
            timestamp: Date.now(),
            type: "retry",
            message: "Manual retry requested",
        });

        // Remove all messages after the last user message
        useChatStore.getState().clearCurrentMessages();
        const keptMessages = currentMessages.slice(0, actualIdx + 1);

        // Re-add kept messages manually
        keptMessages.forEach((msg) => useChatStore.getState().addMessage(msg));

        // Re-send
        await sendMessage(lastUserContent, true);
    }, [addDebugLog, isStreaming, sendMessage]);

    return {
        messages,
        isStreaming,
        sendMessage,
        retryLastMessage,
        stopStreaming,
    };
}
