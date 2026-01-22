import { useState, useRef, useEffect } from "react";
import { Send, Loader2, Sparkles, Trash2, Settings2, StopCircle, Wrench } from "lucide-react";
import { useAI } from "@/hooks/useAI";
import { useUIStore } from "@/stores/uiStore";

export function AIChat() {
    const { messages, isStreaming, sendMessage, stopStreaming, setMessages } = useAI();
    const toggleSettings = useUIStore((state) => state.toggleSettings);
    const [input, setInput] = useState("");
    const scrollRef = useRef<HTMLDivElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [messages]);

    const handleSend = async () => {
        if (!input.trim() || isStreaming) return;
        const text = input;
        setInput("");
        await sendMessage(text);
    };

    const handleStop = () => {
        stopStreaming();
    };

    const clearChat = () => {
        setMessages([]);
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="panel-header">
                <span className="flex items-center gap-2">
                    <Sparkles className="w-3.5 h-3.5 text-[var(--color-accent-primary)]" />
                    AI Assistant
                </span>
                <div className="flex items-center gap-1">
                    {messages.length > 0 && (
                        <button
                            onClick={clearChat}
                            className="icon-btn"
                            title="Clear chat"
                        >
                            <Trash2 className="w-3.5 h-3.5" />
                        </button>
                    )}
                    <button
                        onClick={toggleSettings}
                        className="icon-btn"
                        title="AI Settings"
                    >
                        <Settings2 className="w-3.5 h-3.5" />
                    </button>
                </div>
            </div>

            {/* Messages */}
            <div
                ref={scrollRef}
                className="flex-1 overflow-y-auto p-3 space-y-3"
            >
                {messages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center text-[var(--color-text-tertiary)]">
                        <Sparkles className="w-12 h-12 opacity-20 mb-3" />
                        <p className="text-sm">Ask me anything about your code</p>
                        <p className="text-xs opacity-60 mt-1">
                            I can help with explanations, refactoring, and more
                        </p>
                    </div>
                ) : (
                    messages.map((msg, idx) => (
                        <div
                            key={idx}
                            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
                        >
                            <div
                                className={`max-w-[85%] rounded-lg px-3 py-2 text-sm animate-slide-up ${msg.role === "user"
                                        ? "bg-[var(--color-accent-primary)] text-white"
                                        : "bg-[var(--color-void-700)] text-[var(--color-text-primary)]"
                                    }`}
                            >
                                {/* Tool operation indicators */}
                                {msg.toolOperations && msg.toolOperations.length > 0 && (
                                    <div className="mb-2 space-y-1">
                                        {msg.toolOperations.map((op, opIdx) => (
                                            <div
                                                key={opIdx}
                                                className={`flex items-center gap-2 text-xs px-2 py-1 rounded ${op.status === "completed"
                                                        ? "bg-emerald-500/20 text-emerald-400"
                                                        : op.status === "started"
                                                            ? "bg-blue-500/20 text-blue-400 animate-pulse"
                                                            : "bg-red-500/20 text-red-400"
                                                    }`}
                                            >
                                                <Wrench className="w-3 h-3" />
                                                <span className="font-medium">
                                                    {op.operation} {op.target}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                )}

                                <p className="whitespace-pre-wrap">{msg.content}</p>
                            </div>
                        </div>
                    ))
                )}

                {/* Loading indicator */}
                {isStreaming && (
                    <div className="flex justify-start">
                        <div className="bg-[var(--color-void-700)] rounded-lg px-3 py-2 text-sm">
                            <div className="flex items-center gap-2 text-[var(--color-text-tertiary)]">
                                <Loader2 className="w-4 h-4 animate-spin" />
                                <span>Thinking...</span>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Input */}
            <div className="p-3 border-t border-[var(--color-border-subtle)]">
                <div className="flex gap-2">
                    <input
                        type="text"
                        value={input}
                        onChange={(e) => setInput(e.target.value)}
                        onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
                        placeholder="Ask AI..."
                        disabled={isStreaming}
                        className="flex-1 px-3 py-2 bg-[var(--color-void-800)] rounded-md border border-[var(--color-border-subtle)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none focus:border-[var(--color-accent-primary)] transition-colors disabled:opacity-50"
                    />
                    {isStreaming ? (
                        <button
                            onClick={handleStop}
                            className="px-3 py-2 bg-red-600 rounded-md text-white hover:bg-red-700 transition-colors flex items-center gap-2"
                            title="Stop generation"
                        >
                            <StopCircle className="w-4 h-4" />
                        </button>
                    ) : (
                        <button
                            onClick={handleSend}
                            disabled={!input.trim()}
                            className="px-3 py-2 bg-[var(--color-accent-primary)] rounded-md text-white disabled:opacity-50 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
                        >
                            <Send className="w-4 h-4" />
                        </button>
                    )}
                </div>
            </div>
        </div>
    );
}
