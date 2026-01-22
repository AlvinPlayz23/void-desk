import { useState, useCallback, useRef } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileStore } from "@/stores/fileStore";

export interface ToolOperation {
    operation: string;
    target: string;
    status: string;
}

export interface Message {
    role: "user" | "assistant";
    content: string;
    tool_call?: string;
    toolOperations?: ToolOperation[];
}

export interface AIResponseChunk {
    content?: string;
    tool_call?: string;
    tool_operation?: ToolOperation;
    error?: string;
    done: boolean;
}

export function useAI() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const { openAIKey, openAIBaseUrl, openAIModelId } = useSettingsStore();
    const { rootPath } = useFileStore();

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

            const userMessage: Message = { role: "user", content: text };
            setMessages((prev) => [...prev, userMessage]);
            setIsStreaming(true);

            const assistantMessage: Message = { role: "assistant", content: "", toolOperations: [] };
            setMessages((prev) => [...prev, assistantMessage]);

            try {
                const onEvent = new Channel<AIResponseChunk>();

                onEvent.onmessage = (chunk: AIResponseChunk) => {
                    // Check abort flag
                    if (abortRef.current) {
                        setIsStreaming(false);
                        return;
                    }

                    if (chunk.error) {
                        setMessages((prev) => {
                            const last = prev[prev.length - 1];
                            return [
                                ...prev.slice(0, -1),
                                { ...last, content: last.content + "\n\nError: " + chunk.error },
                            ];
                        });
                        return;
                    }

                    if (chunk.content) {
                        setMessages((prev) => {
                            const last = prev[prev.length - 1];
                            return [
                                ...prev.slice(0, -1),
                                { ...last, content: last.content + chunk.content },
                            ];
                        });
                    }

                    if (chunk.tool_operation) {
                        setMessages((prev) => {
                            const last = prev[prev.length - 1];
                            const ops = last.toolOperations || [];
                            return [
                                ...prev.slice(0, -1),
                                { ...last, toolOperations: [...ops, chunk.tool_operation!] },
                            ];
                        });
                    }

                    if (chunk.tool_call) {
                        setMessages((prev) => {
                            const last = prev[prev.length - 1];
                            return [
                                ...prev.slice(0, -1),
                                { ...last, tool_call: (last.tool_call || "") + "\n" + chunk.tool_call },
                            ];
                        });
                    }

                    if (chunk.done) {
                        setIsStreaming(false);
                        abortRef.current = false;
                    }
                };

                await invoke("ask_ai_stream", {
                    message: text,
                    apiKey: openAIKey,
                    baseUrl: openAIBaseUrl,
                    modelId: openAIModelId,
                    activePath: rootPath,
                    onEvent,
                });
            } catch (error) {
                console.error("AI Error:", error);
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: "Failed to connect to AI. Please check your settings." },
                ]);
                setIsStreaming(false);
                abortRef.current = false;
            }
        },
        [isStreaming, openAIKey, openAIBaseUrl, openAIModelId, rootPath]
    );

    return {
        messages,
        isStreaming,
        sendMessage,
        stopStreaming,
        setMessages,
    };
}
