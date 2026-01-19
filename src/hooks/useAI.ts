import { useState, useCallback } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";

export interface Message {
    role: "user" | "assistant";
    content: string;
    tool_call?: string;
}

export interface AIResponseChunk {
    content?: string;
    tool_call?: string;
    error?: string;
    done: boolean;
}

export function useAI() {
    const [messages, setMessages] = useState<Message[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const { openAIKey, openAIBaseUrl, openAIModelId } = useSettingsStore();

    const sendMessage = useCallback(
        async (text: string) => {
            if (!text.trim() || isStreaming) return;

            const userMessage: Message = { role: "user", content: text };
            setMessages((prev) => [...prev, userMessage]);
            setIsStreaming(true);

            const assistantMessage: Message = { role: "assistant", content: "" };
            setMessages((prev) => [...prev, assistantMessage]);

            try {
                const onEvent = new Channel<AIResponseChunk>();

                onEvent.onmessage = (chunk: AIResponseChunk) => {
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
                    }
                };

                await invoke("ask_ai_stream", {
                    message: text,
                    apiKey: openAIKey,
                    baseUrl: openAIBaseUrl,
                    modelId: openAIModelId,
                    onEvent,
                });
            } catch (error) {
                console.error("AI Error:", error);
                setMessages((prev) => [
                    ...prev,
                    { role: "assistant", content: "Failed to connect to AI. Please check your settings." },
                ]);
                setIsStreaming(false);
            }
        },
        [isStreaming, openAIKey, openAIBaseUrl, openAIModelId]
    );

    return {
        messages,
        isStreaming,
        sendMessage,
        setMessages,
    };
}
