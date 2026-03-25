import { useState, useCallback, useRef } from "react";
import { invoke, Channel } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";
import { useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import {
    useChatStore,
    ToolOperation,
    Message,
    ChatAttachment,
    selectCurrentMessages,
} from "@/stores/chatStore";

export interface AIResponseChunk {
    content?: string;
    tool_call?: string;
    tool_operation?: ToolOperation;
    reasoning?: string;
    debug?: string;
    debug_type?: string;
    error?: string;
    error_type?: string;
    error_status?: number;
    retryable?: boolean;
    done: boolean;
}

interface ConversationHistoryMessage {
    role: "user" | "assistant";
    content: string;
}

const DEFAULT_CONTEXT_WINDOW_TOKENS = 32_000;
const MIN_CONTEXT_WINDOW_TOKENS = 1_024;

interface BackendImageAttachment {
    name: string;
    mimeType: string;
    dataUrl: string;
    detail?: "low";
    sourceBytes?: number;
    optimizedBytes?: number;
}

const summarizeToolOperations = (message: Message) => {
    const operations = message.toolOperations
        ?? message.parts
            .filter((part): part is Extract<typeof message.parts[number], { type: "tool" }> => part.type === "tool")
            .map((part) => part.toolOperation);

    if (!operations || operations.length === 0) {
        return "";
    }

    return operations
        .slice(-6)
        .map((operation) => `${operation.operation} ${operation.target}`)
        .join("; ");
};

const TRANSIENT_ASSISTANT_ERROR_PATTERN = /\n{2,}Error(?: \([^)]+\))?:[\s\S]*$/;

const stripTransientAssistantError = (message: Message, content: string) => {
    if (message.role !== "assistant") {
        return content;
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const trimmed = normalized.trim();

    if (!message.toolOperations?.length && /^Error(?: \([^)]+\))?:/s.test(trimmed)) {
        return "";
    }

    return normalized.replace(TRANSIENT_ASSISTANT_ERROR_PATTERN, "").trimEnd();
};

const historyContentForMessage = (message: Message) => {
    const content = stripTransientAssistantError(message, message.content).trim();
    const toolSummary = summarizeToolOperations(message);
    if (content && toolSummary) {
        return `${content}\n\n[Tool activity: ${toolSummary}]`;
    }
    if (content) {
        return content;
    }
    if (toolSummary) {
        return `[Tool activity: ${toolSummary}]`;
    }
    return "";
};

const serializeConversationHistory = (messages: Message[]): ConversationHistoryMessage[] =>
    messages
        .filter((message): message is Message & { role: "user" | "assistant" } =>
            message.role === "user" || message.role === "assistant"
        )
        .map((message) => ({ role: message.role, content: historyContentForMessage(message) }))
        .filter((message) => message.content.trim().length > 0);

const estimateMessageTokens = (message: Message) => {
    let chars = message.content.length;
    if (message.tool_call) {
        chars += message.tool_call.length;
    }
    if (message.toolOperations) {
        for (const operation of message.toolOperations) {
            chars += operation.operation.length + operation.target.length + (operation.details?.length ?? 0);
        }
    }
    return Math.max(1, Math.floor(chars / 4)) + 8;
};

const trimConversationHistory = (messages: Message[], requestedContextWindow?: number) => {
    const effectiveWindow = Math.max(requestedContextWindow ?? DEFAULT_CONTEXT_WINDOW_TOKENS, MIN_CONTEXT_WINDOW_TOKENS);
    const reserve = Math.min(Math.max(Math.floor(effectiveWindow / 5), 512), 8_192);
    const historyBudget = Math.max(0, effectiveWindow - reserve);
    if (historyBudget === 0 || messages.length === 0) {
        return [];
    }

    const kept: Message[] = [];
    let usedTokens = 0;

    for (let i = messages.length - 1; i >= 0; i--) {
        const message = messages[i];
        const messageTokens = estimateMessageTokens(message);
        if (kept.length > 0 && usedTokens + messageTokens > historyBudget) {
            break;
        }
        usedTokens += messageTokens;
        kept.push(message);
    }

    return kept.reverse();
};

const createMessageId = () => globalThis.crypto?.randomUUID?.() ?? `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const RETRY_DELAYS_MS = [0, 10_000, 20_000, 50_000, 70_000, 80_000, 90_000, 100_000, 120_000, 150_000];
const MAX_FRONTEND_API_RETRIES = RETRY_DELAYS_MS.length;
const MAX_INLINE_IMAGE_BYTES = 350 * 1024;
const MAX_INLINE_IMAGE_DIMENSION = 1280;

const formatAttachmentSummary = (attachments: ChatAttachment[]) => {
    if (attachments.length === 0) return "none";

    return attachments
        .map((attachment) => {
            if (attachment.kind === "text") {
                return `${attachment.name} [text ${attachment.textContent.length} chars]`;
            }

            const approxKb = Math.round(attachment.dataUrl.length / 1024);
            return `${attachment.name} [image ~${approxKb}KB data-url]`;
        })
        .join(", ");
};

const estimateDataUrlBytes = (dataUrl: string) => {
    const commaIndex = dataUrl.indexOf(",");
    const base64 = commaIndex >= 0 ? dataUrl.slice(commaIndex + 1) : dataUrl;
    const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
    return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
};

const extractDataUrlMimeType = (dataUrl: string) => {
    const match = /^data:([^;]+);base64,/.exec(dataUrl);
    return match?.[1] || null;
};

const loadImageElement = (src: string) =>
    new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Failed to load image attachment for optimization"));
        image.src = src;
    });

const canvasToDataUrl = (canvas: HTMLCanvasElement, mimeType: string, quality?: number) => {
    try {
        return quality === undefined ? canvas.toDataURL(mimeType) : canvas.toDataURL(mimeType, quality);
    } catch {
        return null;
    }
};

const optimizeImageAttachmentForTransport = async (
    attachment: Extract<ChatAttachment, { kind: "image" }>
): Promise<BackendImageAttachment> => {
    const sourceBytes = estimateDataUrlBytes(attachment.dataUrl);
    const basePayload: BackendImageAttachment = {
        name: attachment.name,
        mimeType: attachment.mimeType,
        dataUrl: attachment.dataUrl,
        detail: sourceBytes > MAX_INLINE_IMAGE_BYTES ? "low" : undefined,
        sourceBytes,
        optimizedBytes: sourceBytes,
    };

    if (sourceBytes <= MAX_INLINE_IMAGE_BYTES) {
        return basePayload;
    }

    const image = await loadImageElement(attachment.dataUrl);
    const longestSide = Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height);
    const scale = longestSide > MAX_INLINE_IMAGE_DIMENSION ? MAX_INLINE_IMAGE_DIMENSION / longestSide : 1;
    const targetWidth = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    const targetHeight = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));

    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) {
        return basePayload;
    }

    context.drawImage(image, 0, 0, targetWidth, targetHeight);

    const candidateUrls = [
        canvasToDataUrl(canvas, "image/webp", 0.82),
        canvasToDataUrl(canvas, "image/webp", 0.68),
        canvasToDataUrl(canvas, "image/jpeg", 0.82),
        canvasToDataUrl(canvas, "image/jpeg", 0.68),
    ].filter((candidate): candidate is string => Boolean(candidate));

    let bestDataUrl = attachment.dataUrl;
    let bestBytes = sourceBytes;
    for (const candidate of candidateUrls) {
        const candidateBytes = estimateDataUrlBytes(candidate);
        if (candidateBytes < bestBytes) {
            bestDataUrl = candidate;
            bestBytes = candidateBytes;
        }
    }

    return {
        name: attachment.name,
        mimeType: extractDataUrlMimeType(bestDataUrl) || attachment.mimeType,
        dataUrl: bestDataUrl,
        detail: "low",
        sourceBytes,
        optimizedBytes: bestBytes,
    };
};

export function useAI() {
    const [isStreaming, setIsStreaming] = useState(false);
    const { openAIKey, openAIBaseUrl, selectedModelId, aiModels, rawStreamLoggingEnabled, chatContextWindow } = useSettingsStore();
    const { rootPath } = useFileStore();
    const { refreshFileTree } = useFileSystem();
    const messages = useChatStore(selectCurrentMessages);
    const activeSessionId = useChatStore((state) => state.activeSessionId);
    const addMessage = useChatStore((state) => state.addMessage);
    const appendToLastMessage = useChatStore((state) => state.appendToLastMessage);
    const appendReasoningToLastMessage = useChatStore((state) => state.appendReasoningToLastMessage);
    const addToolOperation = useChatStore((state) => state.addToolOperation);
    const addToolOperationToLastReasoning = useChatStore((state) => state.addToolOperationToLastReasoning);
    const updateLastMessage = useChatStore((state) => state.updateLastMessage);
    const removeLastMessage = useChatStore((state) => state.removeLastMessage);
    const addDebugLog = useChatStore((state) => state.addDebugLog);
    const clearCurrentMessages = useChatStore((state) => state.clearCurrentMessages);

    // Store abort flag
    const abortRef = useRef(false);
    const retryAttemptsRef = useRef(0);
    const currentMessageRef = useRef("");
    const pendingRetryRef = useRef(false);
    const activeRequestRef = useRef(0);
    const activeRunIdRef = useRef<string | null>(null);
    const currentAttachmentsRef = useRef<ChatAttachment[]>([]);
    const inReasoningContextRef = useRef(false);

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
        async (text: string, attachments: ChatAttachment[] = [], isRetry = false) => {
            if ((!text.trim() && attachments.length === 0) || isStreaming) return;

            // Reset abort flag
            abortRef.current = false;
            if (!isRetry) {
                retryAttemptsRef.current = 0;
            }
            currentMessageRef.current = text;
            currentAttachmentsRef.current = attachments;
            pendingRetryRef.current = false;
            const currentSessionMessages = useChatStore.getState().currentMessages();
            const lastSessionMessage = currentSessionMessages[currentSessionMessages.length - 1];
            const priorMessages = isRetry && lastSessionMessage?.role === "user"
                ? currentSessionMessages.slice(0, -1)
                : currentSessionMessages;
            const historyMessages = serializeConversationHistory(trimConversationHistory(priorMessages, chatContextWindow));
            const requestId = activeRequestRef.current + 1;
            activeRequestRef.current = requestId;
            const runId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            activeRunIdRef.current = runId;
            let firstContentChunkSeen = false;

            const imageAttachmentCount = attachments.filter((attachment) => attachment.kind === "image").length;
            const textAttachmentCount = attachments.length - imageAttachmentCount;
            const activeModelId = selectedModelId || aiModels[0]?.id || "gpt-4o";
            const activeModel = aiModels.find((model) => model.id === activeModelId);
            const activeModelSupportsImages = activeModel?.supportsImages ?? false;
            const attachmentPreparedModelIds = [...new Set(attachments.map((attachment) => attachment.preparedForModelId).filter(Boolean))];

            if (imageAttachmentCount > 0 && !activeModelSupportsImages) {
                addDebugLog({
                    timestamp: Date.now(),
                    type: "error",
                    message: `Send blocked before backend invoke: model ${activeModelId} is not marked as vision-enabled, but ${imageAttachmentCount} image attachment(s) were queued${attachmentPreparedModelIds.length > 0 ? ` (prepared under ${attachmentPreparedModelIds.join(", ")})` : ""}`,
                });
                return;
            }

            addDebugLog({
                timestamp: Date.now(),
                type: "send",
                message: `${isRetry ? "Retrying" : "Sending"} request ${runId}: prompt=${text.length} chars, history=${historyMessages.length}, attachments=${attachments.length} (${textAttachmentCount} text, ${imageAttachmentCount} image)`,
            });

            if (!isRetry) {
                const userMessage: Message = {
                    id: createMessageId(),
                    role: "user",
                    content: text,
                    parts: text ? [{ type: "text", text }] : [],
                    attachments: attachments.length > 0 ? attachments : undefined,
                    timestamp: Date.now(),
                };
                addMessage(userMessage);
            }

            const assistantMessage: Message = {
                id: createMessageId(),
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
                addDebugLog({
                    timestamp: Date.now(),
                    type: "attachment",
                    message: `Loading ${contextPaths.length} @-mentioned context file(s) for request ${runId}`,
                });

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
                    addDebugLog({
                        timestamp: Date.now(),
                        type: "attachment",
                        message: `Loaded ${contextParts.length} context file(s) for request ${runId}`,
                    });
                }
                // Clear context paths after use
                useChatStore.getState().clearContextPaths();
            }

            // Process attachments
            const imageAttachments: BackendImageAttachment[] = [];
            const imageOptimizationSummaries: string[] = [];
            for (const att of attachments) {
                if (att.kind === "text") {
                    contextContent += `\n\n--- Attached file: ${att.name} ---\n${att.textContent}`;
                } else if (att.kind === "image") {
                    try {
                        const payload = await optimizeImageAttachmentForTransport(att);
                        imageAttachments.push(payload);

                        if ((payload.optimizedBytes || 0) < (payload.sourceBytes || 0)) {
                            imageOptimizationSummaries.push(
                                `${att.name}: ${Math.round((payload.sourceBytes || 0) / 1024)}KB → ${Math.round((payload.optimizedBytes || 0) / 1024)}KB`
                            );
                        }
                    } catch (error) {
                        addDebugLog({
                            timestamp: Date.now(),
                            type: "warn",
                            message: `Image optimization failed for ${att.name}; using original payload (${String(error)})`,
                        });
                        imageAttachments.push({
                            name: att.name,
                            mimeType: att.mimeType,
                            dataUrl: att.dataUrl,
                            detail: "low",
                            sourceBytes: estimateDataUrlBytes(att.dataUrl),
                            optimizedBytes: estimateDataUrlBytes(att.dataUrl),
                        });
                    }
                }
            }

            if (imageOptimizationSummaries.length > 0) {
                addDebugLog({
                    timestamp: Date.now(),
                    type: "attachment",
                    message: `Optimized image payloads for request ${runId}: ${imageOptimizationSummaries.join(", ")}`,
                });
            }

            if (attachments.length > 0) {
                addDebugLog({
                    timestamp: Date.now(),
                    type: "attachment",
                    message: `Prepared attachments for request ${runId}: ${formatAttachmentSummary(attachments)}`,
                });
            }

            // Combine user message with context
            const fullMessage = text + contextContent;

            if (imageAttachmentCount > 0 && attachmentPreparedModelIds.length > 0 && !attachmentPreparedModelIds.includes(activeModelId)) {
                addDebugLog({
                    timestamp: Date.now(),
                    type: "warn",
                    message: `Request ${runId} is sending image attachment(s) with model ${activeModelId}, but they were prepared while ${attachmentPreparedModelIds.join(", ")} was selected`,
                });
            }

            addDebugLog({
                timestamp: Date.now(),
                type: "backend",
                message: `Invoking backend for request ${runId}: model=${activeModelId}, payload=${fullMessage.length} chars, inlineImages=${imageAttachments.length}, imageBytes=${imageAttachments.reduce((sum, attachment) => sum + (attachment.optimizedBytes || 0), 0)}, rawStream=${rawStreamLoggingEnabled ? "on" : "off"}`,
            });

            try {
                const onEvent = new Channel<AIResponseChunk>();

                onEvent.onmessage = (chunk: AIResponseChunk) => {
                    // Check abort flag
                    if (abortRef.current) {
                        setIsStreaming(false);
                        return;
                    }

                    if (chunk.error) {
                        const errorStatusLabel = chunk.error_status ? ` status=${chunk.error_status}` : "";
                        const retryableLabel = chunk.retryable ? " retryable" : "";
                        const canAutoRetry = Boolean(chunk.retryable)
                            && retryAttemptsRef.current < MAX_FRONTEND_API_RETRIES
                            && !pendingRetryRef.current
                            && activeRequestRef.current === requestId;

                        addDebugLog({
                            timestamp: Date.now(),
                            type: "error",
                            message: `Request ${runId} failed (${chunk.error_type ?? "unknown"}${errorStatusLabel}${retryableLabel}): ${chunk.error}`,
                        });

                        if (canAutoRetry) {
                            retryAttemptsRef.current += 1;
                            pendingRetryRef.current = true;
                            setIsStreaming(false);
                            activeRunIdRef.current = null;

                            addDebugLog({
                                timestamp: Date.now(),
                                type: "retry",
                                message: `Scheduling auto-retry ${retryAttemptsRef.current}/${MAX_FRONTEND_API_RETRIES} for request ${runId}${errorStatusLabel || retryableLabel ? ` (${[errorStatusLabel.trim(), retryableLabel.trim()].filter(Boolean).join(", ")})` : ""}`,
                            });

                            const retryDelayMs = RETRY_DELAYS_MS[retryAttemptsRef.current - 1] ?? 80_000;
                            setTimeout(() => {
                                if (abortRef.current || activeRequestRef.current !== requestId) return;
                                useChatStore.getState().removeLastMessage();
                                sendMessage(currentMessageRef.current, currentAttachmentsRef.current, true);
                            }, retryDelayMs);
                            return;
                        }

                        const current = useChatStore.getState().currentMessages();
                        const lastMessage = current[current.length - 1];
                        const isEmptyAssistantPlaceholder = lastMessage?.role === "assistant"
                            && !lastMessage.content.trim()
                            && (!lastMessage.toolOperations || lastMessage.toolOperations.length === 0)
                            && lastMessage.parts.length === 0;

                        if (isEmptyAssistantPlaceholder) {
                            removeLastMessage();
                        }

                        if (chunk.error_status === 422) {
                            addDebugLog({
                                timestamp: Date.now(),
                                type: "error",
                                message: "Request rejected with 422. Try again or reduce context size / attachment size.",
                            });
                        }

                        setIsStreaming(false);
                        abortRef.current = false;
                        pendingRetryRef.current = false;
                        activeRunIdRef.current = null;
                        return;
                    }

                    if (chunk.content) {
                        if (!firstContentChunkSeen) {
                            firstContentChunkSeen = true;
                            addDebugLog({
                                timestamp: Date.now(),
                                type: "stream",
                                message: `First assistant text chunk received for request ${runId}`,
                            });
                        }
                        appendToLastMessage(chunk.content);
                    }

                    if (chunk.reasoning) {
                        inReasoningContextRef.current = true;
                        appendReasoningToLastMessage(chunk.reasoning);
                    }

                    if (chunk.tool_operation) {
                        if (inReasoningContextRef.current) {
                            addToolOperationToLastReasoning(chunk.tool_operation);
                        } else {
                            addToolOperation(chunk.tool_operation);
                        }

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
                            type: chunk.debug_type || "raw",
                            message: chunk.debug,
                        });
                    }

                    if (chunk.done) {
                        setIsStreaming(false);
                        abortRef.current = false;
                        pendingRetryRef.current = false;
                        activeRunIdRef.current = null;
                        retryAttemptsRef.current = 0;
                        inReasoningContextRef.current = false;

                        addDebugLog({
                            timestamp: Date.now(),
                            type: "success",
                            message: `Request ${runId} stream complete`,
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
                    imageAttachments: imageAttachments.length > 0 ? imageAttachments : null,
                    activePath: rootPath,
                    debugRawStream: rawStreamLoggingEnabled,
                    requestId: runId,
                    onEvent,
                });

                addDebugLog({
                    timestamp: Date.now(),
                    type: "backend",
                    message: `Backend invocation accepted for request ${runId}`,
                });
            } catch (error) {
                console.error("AI Error:", error);
                updateLastMessage({
                    content: "Failed to connect to AI. Please check your settings."
                });
                addDebugLog({
                    timestamp: Date.now(),
                    type: "error",
                    message: `Backend invocation failed before streaming for request ${runId}: ${String(error)}`,
                });
                setIsStreaming(false);
                abortRef.current = false;
                pendingRetryRef.current = false;
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
            appendReasoningToLastMessage,
            addToolOperation,
            updateLastMessage,
            removeLastMessage,
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
        const lastUserAttachments = currentMessages[actualIdx].attachments || [];

        retryAttemptsRef.current = 0;
        pendingRetryRef.current = false;
        abortRef.current = false;

        addDebugLog({
            timestamp: Date.now(),
            type: "retry",
            message: "Manual retry requested",
        });

        // Remove all messages after the last user message
        clearCurrentMessages();
        const keptMessages = currentMessages.slice(0, actualIdx + 1);

        // Re-add kept messages manually
        keptMessages.forEach((msg) => addMessage(msg));

        // Re-send
        await sendMessage(lastUserContent, lastUserAttachments, true);
    }, [addDebugLog, addMessage, clearCurrentMessages, isStreaming, sendMessage]);

    return {
        messages,
        isStreaming,
        sendMessage,
        retryLastMessage,
        stopStreaming,
    };
}
