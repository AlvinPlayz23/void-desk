import { create } from "zustand";
import { persist } from "zustand/middleware";

type Theme = "dark" | "light";

interface UIState {
    // Theme
    theme: Theme;

    // Panel sizes (percentages)
    sidebarWidth: number;
    aiPanelWidth: number;

    // Visibility
    isSidebarVisible: boolean;
    isAIPanelVisible: boolean;
    isCommandPaletteVisible: boolean;
    isSettingsVisible: boolean;
    commandPaletteMode: "command" | "file";

    // Actions
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;

    setSidebarWidth: (width: number) => void;
    setAIPanelWidth: (width: number) => void;

    toggleSidebar: () => void;
    toggleAIPanel: () => void;
    toggleSettings: () => void;

    setCommandPaletteVisible: (visible: boolean) => void;
    setCommandPaletteMode: (mode: "command" | "file") => void;
    openCommandPalette: (mode: "command" | "file") => void;
    closeCommandPalette: () => void;
}

export const useUIStore = create<UIState>()(
    persist(
        (set, get) => ({
            theme: "dark",
            sidebarWidth: 240,
            aiPanelWidth: 360,
            isSidebarVisible: true,
            isAIPanelVisible: false,
            isCommandPaletteVisible: false,
            isSettingsVisible: false,
            commandPaletteMode: "command",

            setTheme: (theme) => set({ theme }),

            toggleTheme: () => set({ theme: get().theme === "dark" ? "light" : "dark" }),

            setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(400, width)) }),

            setAIPanelWidth: (width) => set({ aiPanelWidth: Math.max(280, Math.min(600, width)) }),

            toggleSidebar: () => set({ isSidebarVisible: !get().isSidebarVisible }),

            toggleAIPanel: () => set({ isAIPanelVisible: !get().isAIPanelVisible }),

            toggleSettings: () => set({ isSettingsVisible: !get().isSettingsVisible }),

            setCommandPaletteVisible: (visible) => set({ isCommandPaletteVisible: visible }),
            setCommandPaletteMode: (mode) => set({ commandPaletteMode: mode }),
            openCommandPalette: (mode) => set({ isCommandPaletteVisible: true, commandPaletteMode: mode }),
            closeCommandPalette: () => set({ isCommandPaletteVisible: false }),
        }),
        {
            name: "voidesk-ui-settings",
        }
    )
);
