import { useState, useCallback, useRef, useEffect } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";

export interface InlineCompletionResult {
    text: string;
    done: boolean;
    error?: string;
}

export interface InlineCompletionState {
    completion: string | null;
    isLoading: boolean;
}

export function useInlineCompletion() {
    const [completion, setCompletion] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const { openAIKey, openAIBaseUrl, selectedModelId, aiModels, inlineCompletionsEnabled } = useSettingsStore();

    const debounceRef = useRef<ReturnType<typeof setTimeout>>();
    const abortRef = useRef(false);
    const requestIdRef = useRef(0);
    
    // Keep a ref to the current completion for synchronous access in keymaps
    const completionRef = useRef<string | null>(null);
    
    // Sync the ref with state
    useEffect(() => {
        completionRef.current = completion;
    }, [completion]);

    const clearCompletion = useCallback(() => {
        setCompletion(null);
        completionRef.current = null;
        abortRef.current = true;
        if (debounceRef.current) {
            clearTimeout(debounceRef.current);
        }
    }, []);

    const requestCompletion = useCallback(
        (content: string, cursorPos: number, filePath: string, language: string) => {
            if (!openAIKey || !inlineCompletionsEnabled) {
                return;
            }

            if (debounceRef.current) {
                clearTimeout(debounceRef.current);
            }
            abortRef.current = true;
            setCompletion(null);
            completionRef.current = null;

            debounceRef.current = setTimeout(async () => {
                const currentRequestId = ++requestIdRef.current;
                abortRef.current = false;
                setIsLoading(true);

                try {
                    const onEvent = new Channel<InlineCompletionResult>();
                    let fullText = "";

                    onEvent.onmessage = (chunk) => {
                        if (abortRef.current || requestIdRef.current !== currentRequestId) {
                            return;
                        }

                        if (chunk.error) {
                            console.error("Inline completion error:", chunk.error);
                            setIsLoading(false);
                            return;
                        }

                        if (chunk.text) {
                            fullText += chunk.text;
                            setCompletion(fullText);
                            completionRef.current = fullText;
                        }

                        if (chunk.done) {
                            setIsLoading(false);
                        }
                    };

                    const activeModelId = selectedModelId || aiModels[0]?.id || "gpt-4o";
                    await invoke("get_inline_completion", {
                        content,
                        cursorPos,
                        filePath,
                        language,
                        apiKey: openAIKey,
                        baseUrl: openAIBaseUrl,
                        modelId: activeModelId,
                        onEvent,
                    });
                } catch (error) {
                    if (requestIdRef.current === currentRequestId) {
                        console.error("Inline completion failed:", error);
                        setIsLoading(false);
                    }
                }
            }, 500);
        },
        [openAIKey, openAIBaseUrl, selectedModelId, aiModels, inlineCompletionsEnabled]
    );

    // These functions use the ref for synchronous access
    const acceptWord = useCallback(() => {
        const current = completionRef.current;
        if (!current) return null;
        const match = current.match(/^\S+\s?/);
        if (match) {
            const word = match[0];
            const remaining = current.slice(word.length) || null;
            setCompletion(remaining);
            completionRef.current = remaining;
            return word;
        }
        return null;
    }, []);

    const acceptAll = useCallback(() => {
        const text = completionRef.current;
        setCompletion(null);
        completionRef.current = null;
        return text;
    }, []);

    // Getter for checking if completion exists (for keymap handlers)
    const hasCompletion = useCallback(() => {
        return completionRef.current !== null && completionRef.current.length > 0;
    }, []);

    return {
        completion,
        isLoading,
        clearCompletion,
        requestCompletion,
        acceptWord,
        acceptAll,
        hasCompletion,
        completionRef,
    };
}
