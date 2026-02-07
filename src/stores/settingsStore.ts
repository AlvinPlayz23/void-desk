import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface KeyBinding {
    id: string;
    name: string;
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
}

export interface AIModelConfig {
    id: string;
    name: string;
}

export const DEFAULT_KEYBINDINGS: KeyBinding[] = [
    { id: "save", name: "Save File", key: "s", ctrl: true },
    { id: "openFolder", name: "Open Folder", key: "o", ctrl: true },
    { id: "closeTab", name: "Close Tab", key: "w", ctrl: true },
    { id: "commandPalette", name: "Command Palette", key: "p", ctrl: true, shift: true },
    { id: "quickOpen", name: "Quick Open File", key: "p", ctrl: true },
    { id: "settings", name: "Open Settings", key: ",", ctrl: true },
    { id: "toggleSidebar", name: "Toggle Sidebar", key: "b", ctrl: true },
    { id: "toggleAIPanel", name: "Toggle AI Panel", key: "l", ctrl: true, shift: true },
    { id: "toggleTerminal", name: "Toggle Terminal", key: "`", ctrl: true },
];

interface SettingsState {
    // AI Settings
    openAIKey: string;
    openAIBaseUrl: string;
    aiModels: AIModelConfig[];
    selectedModelId: string;
    inlineCompletionsEnabled: boolean;
    rawStreamLoggingEnabled: boolean;

    // Appearance Settings
    editorFontSize: number;
    editorFontFamily: string;
    uiScale: number;

    // Editor Settings
    tabSize: number;
    wordWrap: boolean;
    lineNumbers: boolean;
    minimap: boolean;

    // Keybindings
    keybindings: KeyBinding[];

    // Actions - AI
    setOpenAIKey: (key: string) => void;
    setOpenAIBaseUrl: (url: string) => void;
    setAIModels: (models: AIModelConfig[]) => void;
    addAIModel: (model: AIModelConfig) => void;
    updateAIModel: (id: string, updates: Partial<AIModelConfig>) => void;
    removeAIModel: (id: string) => void;
    setSelectedModelId: (id: string) => void;
    setInlineCompletionsEnabled: (enabled: boolean) => void;
    setRawStreamLoggingEnabled: (enabled: boolean) => void;

    // Actions - Appearance
    setEditorFontSize: (size: number) => void;
    setEditorFontFamily: (family: string) => void;
    setUIScale: (scale: number) => void;

    // Actions - Editor
    setTabSize: (size: number) => void;
    setWordWrap: (enabled: boolean) => void;
    setLineNumbers: (enabled: boolean) => void;
    setMinimap: (enabled: boolean) => void;

    // Actions - Keybindings
    updateKeybinding: (id: string, updates: Partial<KeyBinding>) => void;
    resetKeybindings: () => void;
    getKeybindingConflicts: () => { id1: string; id2: string; key: string }[];

    // Reset
    resetSettings: () => void;
}

const getKeybindingKey = (kb: KeyBinding) => {
    const parts: string[] = [];
    if (kb.ctrl) parts.push("Ctrl");
    if (kb.shift) parts.push("Shift");
    if (kb.alt) parts.push("Alt");
    parts.push(kb.key.toUpperCase());
    return parts.join("+");
};

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set, get) => ({
            // AI Settings
            openAIKey: "",
            openAIBaseUrl: "https://api.openai.com",
            aiModels: [{ id: "gpt-4o", name: "gpt-4o" }],
            selectedModelId: "gpt-4o",
            inlineCompletionsEnabled: true,
            rawStreamLoggingEnabled: false,

            // Appearance Settings
            editorFontSize: 14,
            editorFontFamily: "JetBrains Mono",
            uiScale: 100,

            // Editor Settings
            tabSize: 4,
            wordWrap: false,
            lineNumbers: true,
            minimap: true,

            // Keybindings
            keybindings: [...DEFAULT_KEYBINDINGS],

            // Actions - AI
            setOpenAIKey: (key) => set({ openAIKey: key }),
            setOpenAIBaseUrl: (url) => set({ openAIBaseUrl: url }),
            setAIModels: (models) => set({ aiModels: models }),
            addAIModel: (model) => set((state) => ({ aiModels: [...state.aiModels, model] })),
            updateAIModel: (id, updates) => set((state) => ({
                aiModels: state.aiModels.map((model) =>
                    model.id === id ? { ...model, ...updates } : model
                ),
            })),
            removeAIModel: (id) => set((state) => {
                const filtered = state.aiModels.filter((model) => model.id !== id);
                const nextSelected =
                    state.selectedModelId === id ? filtered[0]?.id || "" : state.selectedModelId;
                return {
                    aiModels: filtered,
                    selectedModelId: nextSelected,
                };
            }),
            setSelectedModelId: (id) => set({ selectedModelId: id }),
            setInlineCompletionsEnabled: (enabled) => set({ inlineCompletionsEnabled: enabled }),
            setRawStreamLoggingEnabled: (enabled) => set({ rawStreamLoggingEnabled: enabled }),

            // Actions - Appearance
            setEditorFontSize: (size) => set({ editorFontSize: Math.max(10, Math.min(32, size)) }),
            setEditorFontFamily: (family) => set({ editorFontFamily: family }),
            setUIScale: (scale) => set({ uiScale: Math.max(75, Math.min(150, scale)) }),

            // Actions - Editor
            setTabSize: (size) => set({ tabSize: Math.max(1, Math.min(8, size)) }),
            setWordWrap: (enabled) => set({ wordWrap: enabled }),
            setLineNumbers: (enabled) => set({ lineNumbers: enabled }),
            setMinimap: (enabled) => set({ minimap: enabled }),

            // Actions - Keybindings
            updateKeybinding: (id, updates) => set((state) => ({
                keybindings: state.keybindings.map((kb) =>
                    kb.id === id ? { ...kb, ...updates } : kb
                ),
            })),
            resetKeybindings: () => set({ keybindings: [...DEFAULT_KEYBINDINGS] }),
            getKeybindingConflicts: () => {
                const conflicts: { id1: string; id2: string; key: string }[] = [];
                const bindings = get().keybindings;
                for (let i = 0; i < bindings.length; i++) {
                    for (let j = i + 1; j < bindings.length; j++) {
                        const key1 = getKeybindingKey(bindings[i]);
                        const key2 = getKeybindingKey(bindings[j]);
                        if (key1 === key2) {
                            conflicts.push({ id1: bindings[i].id, id2: bindings[j].id, key: key1 });
                        }
                    }
                }
                return conflicts;
            },

            // Reset all settings
            resetSettings: () => set({
                openAIKey: "",
                openAIBaseUrl: "https://api.openai.com",
                aiModels: [{ id: "gpt-4o", name: "gpt-4o" }],
                selectedModelId: "gpt-4o",
                inlineCompletionsEnabled: true,
                rawStreamLoggingEnabled: false,
                editorFontSize: 14,
                editorFontFamily: "JetBrains Mono",
                uiScale: 100,
                tabSize: 4,
                wordWrap: false,
                lineNumbers: true,
                minimap: true,
                keybindings: [...DEFAULT_KEYBINDINGS],
            }),
        }),
        {
            name: "voidesk-settings",
        }
    )
);

export { getKeybindingKey };
