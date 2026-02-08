import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "dark" | "light" | "obsidian";
export type SettingsCategory = "appearance" | "ai" | "keybindings" | "editor";

interface UIState {
    // Theme
    theme: Theme;

    // Panel sizes (percentages)
    sidebarWidth: number;
    aiPanelWidth: number;
    terminalHeight: number;

    // Visibility
    isSidebarVisible: boolean;
    isAIPanelVisible: boolean;
    isTerminalVisible: boolean;
    isCommandPaletteVisible: boolean;
    isSettingsVisible: boolean;
    isSettingsPageOpen: boolean;
    settingsCategory: SettingsCategory;
    commandPaletteMode: "command" | "file";

    // Actions
    setTheme: (theme: Theme) => void;
    toggleTheme: () => void;

    setSidebarWidth: (width: number) => void;
    setAIPanelWidth: (width: number) => void;

    toggleSidebar: () => void;
    toggleAIPanel: () => void;
    toggleTerminal: () => void;
    toggleSettings: () => void;

    setTerminalHeight: (height: number) => void;

    setCommandPaletteVisible: (visible: boolean) => void;
    setCommandPaletteMode: (mode: "command" | "file") => void;
    openCommandPalette: (mode: "command" | "file") => void;
    closeCommandPalette: () => void;

    // Settings Page
    openSettingsPage: (category?: SettingsCategory) => void;
    closeSettingsPage: () => void;
    setSettingsCategory: (category: SettingsCategory) => void;
}

export const useUIStore = create<UIState>()(
    persist(
        (set, get) => ({
            theme: "obsidian",
            sidebarWidth: 240,
            aiPanelWidth: 360,
            terminalHeight: 280,
            isSidebarVisible: true,
            isAIPanelVisible: false,
            isTerminalVisible: false,
            isCommandPaletteVisible: false,
            isSettingsVisible: false,
            isSettingsPageOpen: false,
            settingsCategory: "appearance",
            commandPaletteMode: "command",

            setTheme: (theme) => set({ theme }),

            toggleTheme: () => {
                const themes: Theme[] = ["obsidian", "dark", "light"];
                const currentIndex = themes.indexOf(get().theme);
                const nextIndex = (currentIndex + 1) % themes.length;
                set({ theme: themes[nextIndex] });
            },

            setSidebarWidth: (width) => set({ sidebarWidth: Math.max(180, Math.min(400, width)) }),

            setAIPanelWidth: (width) => set({ aiPanelWidth: Math.max(280, Math.min(600, width)) }),

            toggleSidebar: () => set({ isSidebarVisible: !get().isSidebarVisible }),

            toggleAIPanel: () => set({ isAIPanelVisible: !get().isAIPanelVisible }),
            toggleTerminal: () => set({ isTerminalVisible: !get().isTerminalVisible }),

            toggleSettings: () => set({ isSettingsVisible: !get().isSettingsVisible }),
            setTerminalHeight: (height) => set({ terminalHeight: Math.max(100, Math.min(800, height)) }),

            setCommandPaletteVisible: (visible) => set({ isCommandPaletteVisible: visible }),
            setCommandPaletteMode: (mode) => set({ commandPaletteMode: mode }),
            openCommandPalette: (mode) => set({ isCommandPaletteVisible: true, commandPaletteMode: mode }),
            closeCommandPalette: () => set({ isCommandPaletteVisible: false }),

            // Settings Page
            openSettingsPage: (category) => set({ 
                isSettingsPageOpen: true, 
                settingsCategory: category || get().settingsCategory 
            }),
            closeSettingsPage: () => set({ isSettingsPageOpen: false }),
            setSettingsCategory: (category) => set({ settingsCategory: category }),
        }),
        {
            name: "voidesk-ui-settings",
            partialize: (state) => ({
                theme: state.theme,
                sidebarWidth: state.sidebarWidth,
                aiPanelWidth: state.aiPanelWidth,
                terminalHeight: state.terminalHeight,
                isSidebarVisible: state.isSidebarVisible,
                isTerminalVisible: state.isTerminalVisible,
                isAIPanelVisible: state.isAIPanelVisible,
            }),
        }
    )
);
