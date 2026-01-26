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
    error?: string;
    done: boolean;
}

export function useAI() {
    const [isStreaming, setIsStreaming] = useState(false);
    const { openAIKey, openAIBaseUrl, openAIModelId } = useSettingsStore();
    const { rootPath } = useFileStore();
    const { refreshFileTree } = useFileSystem();
    const messages = useChatStore((state) => state.currentMessages());
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const { addMessage, appendToLastMessage, addToolOperation, updateLastMessage } = useChatStore();

    // Store abort flag
    const abortRef = useRef(false);

    const stopStreaming = useCallback(() => {
        abortRef.current = true;
        setIsStreaming(false);
    }, []);

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text.trim() || isStreaming) return;

            // Reset abort flag
            abortRef.current = false;

            const userMessage: Message = { role: "user", content: text, timestamp: Date.now() };
            addMessage(userMessage);

            const assistantMessage: Message = { role: "assistant", content: "", toolOperations: [], timestamp: Date.now() };
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

            try {
                const onEvent = new Channel<AIResponseChunk>();

                onEvent.onmessage = (chunk: AIResponseChunk) => {
                    // Check abort flag
                    if (abortRef.current) {
                        setIsStreaming(false);
                        return;
                    }

                    if (chunk.error) {
                        updateLastMessage({
                            content: useChatStore.getState().currentMessages().slice(-1)[0].content + "\n\nError: " + chunk.error
                        });
                        return;
                    }

                    if (chunk.content) {
                        appendToLastMessage(chunk.content);
                    }

                    if (chunk.tool_operation) {
                        addToolOperation(chunk.tool_operation);

                        // Auto-refresh file tree when AI makes changes
                        if (chunk.tool_operation.status === "completed") {
                            const changedOps = ["Writing", "Created", "Executed", "Deleted"];
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
                    }

                    if (chunk.done) {
                        setIsStreaming(false);
                        abortRef.current = false;
                    }
                };

                // Use session-aware command if session is active
                await invoke("ask_ai_stream_with_session", {
                    sessionId: activeSessionId || "",
                    message: fullMessage,
                    apiKey: openAIKey,
                    baseUrl: openAIBaseUrl,
                    modelId: openAIModelId,
                    activePath: rootPath,
                    onEvent,
                });
            } catch (error) {
                console.error("AI Error:", error);
                updateLastMessage({
                    content: "Failed to connect to AI. Please check your settings."
                });
                setIsStreaming(false);
                abortRef.current = false;
            }
        },
        [isStreaming, activeSessionId, openAIKey, openAIBaseUrl, openAIModelId, rootPath, addMessage, appendToLastMessage, addToolOperation, updateLastMessage]
    );

    const retryLastMessage = useCallback(async () => {
        const currentMessages = useChatStore.getState().currentMessages();
        if (currentMessages.length === 0) return;

        // Find last user message
        const lastUserMsgIdx = [...currentMessages].reverse().findIndex(m => m.role === "user");
        if (lastUserMsgIdx === -1) return;

        const actualIdx = currentMessages.length - 1 - lastUserMsgIdx;
        const lastUserContent = currentMessages[actualIdx].content;

        // Remove all messages after the last user message
        useChatStore.getState().clearCurrentMessages();
        const keptMessages = currentMessages.slice(0, actualIdx);
        
        // Re-add kept messages manually
        keptMessages.forEach(msg => useChatStore.getState().addMessage(msg));

        // Re-send
        await sendMessage(lastUserContent);
    }, [sendMessage]);

    return {
        messages,
        isStreaming,
        sendMessage,
        retryLastMessage,
        stopStreaming,
    };
}
