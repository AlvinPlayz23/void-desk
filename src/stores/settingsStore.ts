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
    supportsImages: boolean;
}

export type AIProviderType = "openai_compatible" | "codex_subscription";

export interface AIProviderPreset {
    id: string;
    name: string;
    providerType: AIProviderType;
    apiKey: string;
    baseUrl: string;
    models: AIModelConfig[];
    selectedModelId: string;
}

export interface ActiveAISettings {
    providerPresetsEnabled: boolean;
    providerType: AIProviderType;
    apiKey: string;
    baseUrl: string;
    aiModels: AIModelConfig[];
    selectedModelId: string;
    activeModel: AIModelConfig | null;
    activePreset: AIProviderPreset | null;
}

const FALLBACK_AI_MODEL: AIModelConfig = {
    id: "gpt-4o",
    name: "gpt-4o",
    supportsImages: false,
};

const FALLBACK_AI_MODELS: AIModelConfig[] = [FALLBACK_AI_MODEL];

const DEFAULT_CODEX_MODELS: AIModelConfig[] = [
    {
        id: "gpt-5.4",
        name: "gpt-5.4",
        supportsImages: false,
    },
    {
        id: "gpt-5.4-mini",
        name: "gpt-5.4-mini",
        supportsImages: false,
    },
    {
        id: "gpt-5.3-codex",
        name: "gpt-5.3-codex",
        supportsImages: false,
    },
    {
        id: "gpt-5.1-codex-mini",
        name: "gpt-5.1-codex-mini",
        supportsImages: false,
    },
];

const FALLBACK_PROVIDER_PRESET: AIProviderPreset = {
    id: "default-provider",
    name: "Default Provider",
    providerType: "openai_compatible",
    apiKey: "",
    baseUrl: "https://api.openai.com",
    models: FALLBACK_AI_MODELS,
    selectedModelId: "gpt-4o",
};

const FALLBACK_PROVIDER_PRESETS: AIProviderPreset[] = [FALLBACK_PROVIDER_PRESET];

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
    providerType: AIProviderType;
    openAIKey: string;
    openAIBaseUrl: string;
    aiModels: AIModelConfig[];
    selectedModelId: string;
    providerPresetsEnabled: boolean;
    providerPresets: AIProviderPreset[];
    selectedProviderPresetId: string;
    inlineCompletionsEnabled: boolean;
    rawStreamLoggingEnabled: boolean;
    chatContextWindow: number;

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
    setProviderType: (providerType: AIProviderType) => void;
    setOpenAIKey: (key: string) => void;
    setOpenAIBaseUrl: (url: string) => void;
    setAIModels: (models: AIModelConfig[]) => void;
    addAIModel: (model: AIModelConfig) => void;
    updateAIModel: (id: string, updates: Partial<AIModelConfig>) => void;
    removeAIModel: (id: string) => void;
    setSelectedModelId: (id: string) => void;
    setProviderPresetsEnabled: (enabled: boolean) => void;
    setProviderPresets: (presets: AIProviderPreset[]) => void;
    setSelectedProviderPresetId: (id: string) => void;
    setPresetSelectedModelId: (presetId: string, modelId: string) => void;
    setInlineCompletionsEnabled: (enabled: boolean) => void;
    setRawStreamLoggingEnabled: (enabled: boolean) => void;
    setChatContextWindow: (tokens: number) => void;

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

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com";
const DEFAULT_CODEX_BASE_URL = "https://chatgpt.com/backend-api";

export const getDefaultModelsForProviderType = (providerType: AIProviderType): AIModelConfig[] =>
    providerType === "codex_subscription"
        ? DEFAULT_CODEX_MODELS.map((model) => ({ ...model }))
        : [createDefaultAIModel()];

export const createDefaultAIModel = (): AIModelConfig => ({
    ...FALLBACK_AI_MODEL,
});

export const isProviderType = (value: unknown): value is AIProviderType =>
    value === "openai_compatible" || value === "codex_subscription";

export const modelsMatchProviderDefaults = (
    models: AIModelConfig[],
    providerType: AIProviderType
): boolean => {
    const defaults = getDefaultModelsForProviderType(providerType);
    return models.length === defaults.length
        && models.every((model, index) =>
            model.id === defaults[index]?.id
            && model.name === defaults[index]?.name
            && model.supportsImages === defaults[index]?.supportsImages
        );
};

export const normalizeAIModels = (models: unknown): AIModelConfig[] => {
    if (!Array.isArray(models) || models.length === 0) {
        return [createDefaultAIModel()];
    }

    const normalized = models.map((model) => {
        const raw = model as Partial<AIModelConfig> | null | undefined;
        return {
            id: typeof raw?.id === "string" ? raw.id : "",
            name: typeof raw?.name === "string" ? raw.name : "",
            supportsImages: Boolean(raw?.supportsImages),
        };
    });

    return normalized.length > 0 ? normalized : [createDefaultAIModel()];
};

export const createProviderPreset = (overrides: Partial<AIProviderPreset> = {}): AIProviderPreset => {
    const providerType = isProviderType(overrides.providerType) ? overrides.providerType : "openai_compatible";
    const models = Array.isArray(overrides.models) && overrides.models.length > 0
        ? normalizeAIModels(overrides.models)
        : getDefaultModelsForProviderType(providerType);
    const selectedModelId =
        typeof overrides.selectedModelId === "string" && models.some((model) => model.id === overrides.selectedModelId)
            ? overrides.selectedModelId
            : models[0]?.id || "";

    return {
        id: overrides.id || `preset-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: overrides.name || "New Preset",
        providerType,
        apiKey: overrides.apiKey || "",
        baseUrl: overrides.baseUrl || (providerType === "codex_subscription" ? DEFAULT_CODEX_BASE_URL : DEFAULT_OPENAI_BASE_URL),
        models,
        selectedModelId,
    };
};

export const getDefaultProviderPresets = (): AIProviderPreset[] => [
    createProviderPreset({
        ...FALLBACK_PROVIDER_PRESET,
        models: [createDefaultAIModel()],
    }),
];

const normalizeProviderPresets = (presets: unknown): AIProviderPreset[] => {
    if (!Array.isArray(presets) || presets.length === 0) {
        return getDefaultProviderPresets();
    }

    const normalized = presets.map((preset, index) => {
        const raw = preset as Partial<AIProviderPreset> | null | undefined;
        return createProviderPreset({
            id: typeof raw?.id === "string" && raw.id.trim() ? raw.id : `preset-${index + 1}`,
            name: typeof raw?.name === "string" ? raw.name : `Preset ${index + 1}`,
            providerType: isProviderType(raw?.providerType) ? raw.providerType : undefined,
            apiKey: typeof raw?.apiKey === "string" ? raw.apiKey : "",
            baseUrl: typeof raw?.baseUrl === "string" && raw.baseUrl.trim() ? raw.baseUrl : undefined,
            models: raw?.models,
            selectedModelId: typeof raw?.selectedModelId === "string" ? raw.selectedModelId : undefined,
        });
    });

    return normalized.length > 0 ? normalized : getDefaultProviderPresets();
};

const normalizeSelectedProviderPresetId = (selectedProviderPresetId: unknown, presets: AIProviderPreset[]) => {
    if (typeof selectedProviderPresetId === "string" && presets.some((preset) => preset.id === selectedProviderPresetId)) {
        return selectedProviderPresetId;
    }
    return presets[0]?.id || "";
};

const getDefaultState = () => ({
    providerType: "openai_compatible" as AIProviderType,
    openAIKey: "",
    openAIBaseUrl: DEFAULT_OPENAI_BASE_URL,
    aiModels: [createDefaultAIModel()],
    selectedModelId: "gpt-4o",
    providerPresetsEnabled: false,
    providerPresets: getDefaultProviderPresets(),
    selectedProviderPresetId: "default-provider",
    inlineCompletionsEnabled: true,
    rawStreamLoggingEnabled: false,
    chatContextWindow: 32000,
    editorFontSize: 14,
    editorFontFamily: "JetBrains Mono",
    uiScale: 100,
    tabSize: 4,
    wordWrap: false,
    lineNumbers: true,
    minimap: true,
    keybindings: [...DEFAULT_KEYBINDINGS],
});

export const selectActiveAISettings = (state: Pick<
    SettingsState,
    "providerType" | "openAIKey" | "openAIBaseUrl" | "aiModels" | "selectedModelId" | "providerPresetsEnabled" | "providerPresets" | "selectedProviderPresetId"
>): ActiveAISettings => {
    const presets = state.providerPresets.length > 0 ? state.providerPresets : FALLBACK_PROVIDER_PRESETS;
    const legacyModels = state.aiModels.length > 0 ? state.aiModels : FALLBACK_AI_MODELS;
    const activePreset = state.providerPresetsEnabled
        ? presets.find((preset) => preset.id === state.selectedProviderPresetId) || presets[0] || null
        : null;
    const aiModels = activePreset?.models.length ? activePreset.models : legacyModels;
    const selectedModelId = activePreset
        ? activePreset.selectedModelId || aiModels[0]?.id || ""
        : state.selectedModelId || legacyModels[0]?.id || "";
    const activeModel = aiModels.find((model) => model.id === selectedModelId) || aiModels[0] || null;

    return {
        providerPresetsEnabled: state.providerPresetsEnabled,
        providerType: activePreset?.providerType || state.providerType || "openai_compatible",
        apiKey: activePreset?.apiKey || state.openAIKey,
        baseUrl: activePreset?.baseUrl || state.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
        aiModels,
        selectedModelId: activeModel?.id || selectedModelId,
        activeModel,
        activePreset,
    };
};

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
            ...getDefaultState(),

            // Actions - AI
            setProviderType: (providerType) => set((state) => {
                const normalizedProviderType = isProviderType(providerType) ? providerType : "openai_compatible";
                const shouldReplaceModels =
                    normalizedProviderType !== state.providerType
                    || !Array.isArray(state.aiModels)
                    || state.aiModels.length === 0
                    || modelsMatchProviderDefaults(state.aiModels, state.providerType)
                    || modelsMatchProviderDefaults(state.aiModels, normalizedProviderType);
                const aiModels = shouldReplaceModels
                    ? getDefaultModelsForProviderType(normalizedProviderType)
                    : state.aiModels;
                const selectedModelId = aiModels.some((model) => model.id === state.selectedModelId)
                    ? state.selectedModelId
                    : aiModels[0]?.id || "";
                return {
                    providerType: normalizedProviderType,
                    openAIBaseUrl: normalizedProviderType === "codex_subscription" && !state.openAIBaseUrl
                        ? DEFAULT_CODEX_BASE_URL
                        : state.openAIBaseUrl,
                    aiModels,
                    selectedModelId,
                };
            }),
            setOpenAIKey: (key) => set({ openAIKey: key }),
            setOpenAIBaseUrl: (url) => set({ openAIBaseUrl: url }),
            setAIModels: (models) => set((state) => {
                const normalized = normalizeAIModels(models);
                const selectedModelId = normalized.some((model) => model.id === state.selectedModelId)
                    ? state.selectedModelId
                    : normalized[0]?.id || "";
                return {
                    aiModels: normalized,
                    selectedModelId,
                };
            }),
            addAIModel: (model) => set((state) => {
                const aiModels = [...state.aiModels, model];
                return { aiModels };
            }),
            updateAIModel: (id, updates) => set((state) => ({
                aiModels: state.aiModels.map((model) =>
                    model.id === id ? { ...model, ...updates } : model
                ),
            })),
            removeAIModel: (id) => set((state) => {
                const filtered = state.aiModels.filter((model) => model.id !== id);
                const normalized = normalizeAIModels(filtered);
                const nextSelected =
                    state.selectedModelId === id ? normalized[0]?.id || "" : state.selectedModelId;
                return {
                    aiModels: normalized,
                    selectedModelId: nextSelected,
                };
            }),
            setSelectedModelId: (id) => set({ selectedModelId: id }),
            setProviderPresetsEnabled: (enabled) => set({ providerPresetsEnabled: enabled }),
            setProviderPresets: (presets) => set((state) => {
                const normalized = normalizeProviderPresets(presets);
                const selectedProviderPresetId = normalizeSelectedProviderPresetId(state.selectedProviderPresetId, normalized);
                return {
                    providerPresets: normalized,
                    selectedProviderPresetId,
                };
            }),
            setSelectedProviderPresetId: (id) => set((state) => {
                const normalized = normalizeProviderPresets(state.providerPresets);
                return {
                    selectedProviderPresetId: normalizeSelectedProviderPresetId(id, normalized),
                };
            }),
            setPresetSelectedModelId: (presetId, modelId) => set((state) => ({
                providerPresets: state.providerPresets.map((preset) => {
                    if (preset.id !== presetId) {
                        return preset;
                    }
                    const selectedModelId = preset.models.some((model) => model.id === modelId)
                        ? modelId
                        : preset.models[0]?.id || "";
                    return {
                        ...preset,
                        selectedModelId,
                    };
                }),
            })),
            setInlineCompletionsEnabled: (enabled) => set({ inlineCompletionsEnabled: enabled }),
            setRawStreamLoggingEnabled: (enabled) => set({ rawStreamLoggingEnabled: enabled }),
            setChatContextWindow: (tokens) => set({ chatContextWindow: Math.max(1024, Math.min(256000, Math.round(tokens || 1024))) }),

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
                ...getDefaultState(),
            }),
        }),
        {
            name: "voidesk-settings",
            version: 4,
            migrate: (persistedState: any, version: number) => {
                if (!persistedState) {
                    return getDefaultState();
                }

                const state = persistedState as any;
                const nextState = {
                    ...getDefaultState(),
                    ...state,
                };

                nextState.providerType = isProviderType(nextState.providerType)
                    ? nextState.providerType
                    : "openai_compatible";

                nextState.aiModels = normalizeAIModels(nextState.aiModels);
                nextState.selectedModelId = nextState.aiModels.some((model: AIModelConfig) => model.id === nextState.selectedModelId)
                    ? nextState.selectedModelId
                    : nextState.aiModels[0]?.id || "";

                if (version < 3) {
                    nextState.providerPresetsEnabled = false;
                    nextState.providerPresets = [
                        createProviderPreset({
                            id: "default-provider",
                            name: "Default Provider",
                            providerType: nextState.providerType,
                            apiKey: nextState.openAIKey || "",
                            baseUrl: nextState.openAIBaseUrl || DEFAULT_OPENAI_BASE_URL,
                            models: nextState.aiModels,
                            selectedModelId: nextState.selectedModelId,
                        }),
                    ];
                    nextState.selectedProviderPresetId = nextState.providerPresets[0]?.id || "";
                } else {
                    nextState.providerPresets = normalizeProviderPresets(nextState.providerPresets);
                    nextState.selectedProviderPresetId = normalizeSelectedProviderPresetId(
                        nextState.selectedProviderPresetId,
                        nextState.providerPresets
                    );
                }

                return nextState;
            },
        }
    )
);

export { getKeybindingKey };
