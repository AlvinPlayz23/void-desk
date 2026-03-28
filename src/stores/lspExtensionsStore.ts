import { create } from "zustand";

export type LspInstallMethod = "pnpm" | "github_release";
export type LspInstallProvider = "pnpm" | "npm" | "bun";

export interface LspExtensionStatus {
    id: string;
    name: string;
    language_ids: string[];
    file_extensions: string[];
    install_method: LspInstallMethod;
    version: string;
    bundled_by_default: boolean;
    coming_soon: boolean;
    description: string;
    installed: boolean;
    installed_version?: string | null;
    latest_version: string;
    update_available: boolean;
    install_source?: string | null;
    install_path?: string | null;
    executable_path?: string | null;
    error?: string | null;
}

interface LspExtensionsState {
    extensions: LspExtensionStatus[];
    isLoading: boolean;
    isEnsuringDefaults: boolean;
    hasEnsuredDefaults: boolean;
    installInFlightIds: string[];
    dismissedPromptIds: string[];
    setExtensions: (extensions: LspExtensionStatus[]) => void;
    setIsLoading: (loading: boolean) => void;
    setIsEnsuringDefaults: (ensuring: boolean) => void;
    setHasEnsuredDefaults: (ensured: boolean) => void;
    markInstalling: (id: string, installing: boolean) => void;
    dismissPrompt: (id: string) => void;
    resetPromptDismissals: () => void;
}

export const useLspExtensionsStore = create<LspExtensionsState>((set) => ({
    extensions: [],
    isLoading: false,
    isEnsuringDefaults: false,
    hasEnsuredDefaults: false,
    installInFlightIds: [],
    dismissedPromptIds: [],
    setExtensions: (extensions) => set({ extensions }),
    setIsLoading: (isLoading) => set({ isLoading }),
    setIsEnsuringDefaults: (isEnsuringDefaults) => set({ isEnsuringDefaults }),
    setHasEnsuredDefaults: (hasEnsuredDefaults) => set({ hasEnsuredDefaults }),
    markInstalling: (id, installing) =>
        set((state) => ({
            installInFlightIds: installing
                ? Array.from(new Set([...state.installInFlightIds, id]))
                : state.installInFlightIds.filter((item) => item !== id),
        })),
    dismissPrompt: (id) =>
        set((state) => ({
            dismissedPromptIds: Array.from(new Set([...state.dismissedPromptIds, id])),
        })),
    resetPromptDismissals: () => set({ dismissedPromptIds: [] }),
}));
