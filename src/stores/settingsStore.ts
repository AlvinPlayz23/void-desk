import { create } from "zustand";
import { persist } from "zustand/middleware";

interface SettingsState {
    openAIKey: string;
    openAIBaseUrl: string;
    openAIModelId: string;

    // Actions
    setOpenAIKey: (key: string) => void;
    setOpenAIBaseUrl: (url: string) => void;
    setOpenAIModelId: (id: string) => void;

    // Reset
    resetSettings: () => void;
}

export const useSettingsStore = create<SettingsState>()(
    persist(
        (set) => ({
            openAIKey: "",
            openAIBaseUrl: "https://api.openai.com",
            openAIModelId: "gpt-4o",

            setOpenAIKey: (key) => set({ openAIKey: key }),
            setOpenAIBaseUrl: (url) => set({ openAIBaseUrl: url }),
            setOpenAIModelId: (id) => set({ openAIModelId: id }),

            resetSettings: () => set({
                openAIKey: "",
                openAIBaseUrl: "https://api.openai.com",
                openAIModelId: "gpt-4o",
            }),
        }),
        {
            name: "voidesk-settings",
        }
    )
);
