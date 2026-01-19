import React, { useState, useEffect } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { X, Key, Globe, Save, AlertCircle, Sparkles, CheckCircle2, Loader2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

export const SettingsModal: React.FC = () => {
    const { isSettingsVisible, toggleSettings } = useUIStore();
    const { openAIKey, openAIBaseUrl, openAIModelId, setOpenAIKey, setOpenAIBaseUrl, setOpenAIModelId } = useSettingsStore();

    const [tempKey, setTempKey] = useState(openAIKey);
    const [tempBaseUrl, setTempBaseUrl] = useState(openAIBaseUrl);
    const [tempModelId, setTempModelId] = useState(openAIModelId);
    const [isSaved, setIsSaved] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    useEffect(() => {
        if (isSettingsVisible) {
            setTempKey(openAIKey);
            setTempBaseUrl(openAIBaseUrl);
            setTempModelId(openAIModelId);
            setIsSaved(false);
            setTestResult(null);
        }
    }, [isSettingsVisible, openAIKey, openAIBaseUrl, openAIModelId]);

    const handleSave = () => {
        setOpenAIKey(tempKey);
        setOpenAIBaseUrl(tempBaseUrl);
        setOpenAIModelId(tempModelId);
        setIsSaved(true);
        setTimeout(() => setIsSaved(false), 2000);
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await invoke<string>("test_ai_connection", {
                apiKey: tempKey,
                baseUrl: tempBaseUrl,
                modelId: tempModelId
            });
            setTestResult({ success: true, message: result });
        } catch (error) {
            setTestResult({ success: false, message: String(error) });
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <Dialog.Root open={isSettingsVisible} onOpenChange={toggleSettings}>
            <Dialog.Portal>
                <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] animate-in fade-in" />
                <Dialog.Content className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-full max-w-md bg-[#1e1e1e] border border-[#333] rounded-xl shadow-2xl z-[101] overflow-hidden focus:outline-none animate-in zoom-in-95 duration-200">
                    <div className="flex items-center justify-between p-4 border-b border-[#333] bg-[#252526]">
                        <Dialog.Title className="text-sm font-semibold text-gray-200 flex items-center gap-2">
                            <Globe className="w-4 h-4 text-blue-400" />
                            AI Settings
                        </Dialog.Title>
                        <Dialog.Close asChild>
                            <button className="p-1 hover:bg-[#333] rounded-md transition-colors text-gray-400 hover:text-white">
                                <X className="w-4 h-4" />
                            </button>
                        </Dialog.Close>
                    </div>

                    <div className="p-6 space-y-6">
                        <div className="space-y-4">
                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 flex items-center gap-2 uppercase tracking-wider">
                                    <Key className="w-3 h-3" />
                                    OpenAI API Key
                                </label>
                                <input
                                    type="password"
                                    value={tempKey}
                                    onChange={(e) => setTempKey(e.target.value)}
                                    placeholder="sk-..."
                                    className="w-full bg-[#2d2d2d] border border-[#3f3f3f] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors"
                                />
                                <p className="text-[10px] text-gray-500 italic">
                                    Your API key is stored locally on this machine.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 flex items-center gap-2 uppercase tracking-wider">
                                    <Globe className="w-3 h-3" />
                                    Base URL (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={tempBaseUrl}
                                    onChange={(e) => setTempBaseUrl(e.target.value)}
                                    placeholder="https://api.openai.com/v1"
                                    className="w-full bg-[#2d2d2d] border border-[#3f3f3f] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors"
                                />
                                <p className="text-[10px] text-gray-500 italic">
                                    Change this if you use an OpenAI-compatible provider.
                                </p>
                            </div>

                            <div className="space-y-2">
                                <label className="text-xs font-medium text-gray-400 flex items-center gap-2 uppercase tracking-wider">
                                    <Sparkles className="w-3 h-3" />
                                    Model ID
                                </label>
                                <input
                                    type="text"
                                    value={tempModelId}
                                    onChange={(e) => setTempModelId(e.target.value)}
                                    placeholder="gpt-4o"
                                    className="w-full bg-[#2d2d2d] border border-[#3f3f3f] rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-blue-500 transition-colors"
                                />
                                <p className="text-[10px] text-gray-500 italic">
                                    The specific model to use (e.g., gpt-4o, gpt-3.5-turbo).
                                </p>
                            </div>
                        </div>

                        {testResult && (
                            <div className={`flex items-start gap-2 text-xs p-3 rounded-md animate-in slide-in-from-top-1 ${testResult.success ? "bg-green-400/10 text-green-400" : "bg-red-400/10 text-red-400"}`}>
                                {testResult.success ? <CheckCircle2 className="w-4 h-4 mt-0.5" /> : <AlertCircle className="w-4 h-4 mt-0.5" />}
                                <div className="flex-1">
                                    <p className="font-semibold">{testResult.success ? "Connection Successful" : "Connection Failed"}</p>
                                    <p className="opacity-80 mt-1">{testResult.message}</p>
                                </div>
                            </div>
                        )}

                        {isSaved && !testResult && (
                            <div className="flex items-center gap-2 text-green-400 text-xs bg-green-400/10 p-2 rounded-md animate-in slide-in-from-top-1">
                                <AlertCircle className="w-3 h-3" />
                                Settings saved successfully!
                            </div>
                        )}
                    </div>

                    <div className="p-4 bg-[#252526] border-t border-[#333] flex items-center justify-between gap-3">
                        <button
                            onClick={handleTest}
                            disabled={isTesting || !tempKey}
                            className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-gray-300 hover:text-white hover:bg-[#333] rounded-lg border border-[#3f3f3f] transition-all disabled:opacity-50"
                        >
                            {isTesting ? (
                                <Loader2 className="w-4 h-4 animate-spin" />
                            ) : (
                                "Test Connection"
                            )}
                        </button>
                        <div className="flex gap-3">
                            <Dialog.Close asChild>
                                <button className="px-4 py-2 text-sm text-gray-300 hover:text-white transition-colors">
                                    Cancel
                                </button>
                            </Dialog.Close>
                            <button
                                onClick={handleSave}
                                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded-lg text-sm font-medium transition-all shadow-lg shadow-blue-900/20 active:scale-95"
                            >
                                <Save className="w-4 h-4" />
                                Save
                            </button>
                        </div>
                    </div>
                </Dialog.Content>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
