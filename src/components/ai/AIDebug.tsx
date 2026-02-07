import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";

export function AIDebug() {
    const [output, setOutput] = useState<string>("");
    const [loading, setLoading] = useState(false);
    const { apiKey, baseUrl, modelId } = useSettingsStore();

    const runDebugToolCall = async () => {
        setLoading(true);
        setOutput("Running debug_tool_call...\n");
        try {
            const result = await invoke<string>("debug_tool_call", {
                apiKey,
                baseUrl,
                modelId,
            });
            setOutput(result);
        } catch (err) {
            setOutput(`Error: ${err}`);
        }
        setLoading(false);
    };

    const runDebugStream = async () => {
        setLoading(true);
        setOutput("Running debug_stream_response...\n");
        try {
            const result = await invoke<string>("debug_stream_response", {
                apiKey,
                baseUrl,
                modelId,
            });
            setOutput(result);
        } catch (err) {
            setOutput(`Error: ${err}`);
        }
        setLoading(false);
    };

    return (
        <div className="p-4 bg-zinc-900 text-white h-full flex flex-col">
            <h2 className="text-lg font-bold mb-4">AI Debug Panel</h2>
            
            <div className="flex gap-2 mb-4">
                <button
                    onClick={runDebugToolCall}
                    disabled={loading}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-700 rounded disabled:opacity-50"
                >
                    Test Tool Call (Non-Stream)
                </button>
                <button
                    onClick={runDebugStream}
                    disabled={loading}
                    className="px-4 py-2 bg-green-600 hover:bg-green-700 rounded disabled:opacity-50"
                >
                    Test Stream Response
                </button>
            </div>

            <div className="text-sm text-zinc-400 mb-2">
                API: {baseUrl} | Model: {modelId}
            </div>

            <pre className="flex-1 overflow-auto bg-black p-4 rounded text-xs font-mono whitespace-pre-wrap">
                {loading ? "Loading..." : output || "Click a button to run a debug test"}
            </pre>
        </div>
    );
}
