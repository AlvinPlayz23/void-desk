import { useEffect, useCallback } from "react";
import { useFileStore } from "@/stores/fileStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileSystem } from "./useFileSystem";

interface ShortcutHandler {
    id: string;
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    action: () => void;
}

export function useKeyboard() {
    const { openFiles, currentFilePath } = useFileStore();
    const { openCommandPalette, openSettingsPage, closeSettingsPage, isSettingsPageOpen, toggleSidebar, toggleAIPanel, toggleTerminal } = useUIStore();
    const { saveFile, openFolder } = useFileSystem();

    const currentFile = openFiles.find((f) => f.path === currentFilePath);

    // Define shortcuts
    const shortcuts: ShortcutHandler[] = [
        // Save file (Ctrl+S)
        {
            id: "save",
            key: "s",
            ctrl: true,
            action: async () => {
                if (currentFile && currentFile.isDirty) {
                    await saveFile(currentFile.path, currentFile.content);
                }
            },
        },
        // Open folder (Ctrl+O)
        {
            id: "openFolder",
            key: "o",
            ctrl: true,
            action: async () => {
                await openFolder();
            },
        },
        // Close tab (Ctrl+W)
        {
            id: "closeTab",
            key: "w",
            ctrl: true,
            action: () => {
                if (currentFilePath) {
                    useFileStore.getState().closeFile(currentFilePath);
                }
            },
        },
        // Command Palette (Ctrl+Shift+P)
        {
            id: "commandPalette",
            key: "p",
            ctrl: true,
            shift: true,
            action: () => {
                openCommandPalette("command");
            },
        },
        // Quick File Open (Ctrl+P)
        {
            id: "quickOpen",
            key: "p",
            ctrl: true,
            action: () => {
                openCommandPalette("file");
            },
        },
        // Open Settings (Ctrl+,)
        {
            id: "settings",
            key: ",",
            ctrl: true,
            action: () => {
                openSettingsPage();
            },
        },
        // Toggle Sidebar (Ctrl+B)
        {
            id: "toggleSidebar",
            key: "b",
            ctrl: true,
            action: () => {
                toggleSidebar();
            },
        },
        // Toggle AI Panel (Ctrl+Shift+L)
        {
            id: "toggleAIPanel",
            key: "l",
            ctrl: true,
            shift: true,
            action: () => {
                toggleAIPanel();
            },
        },
        // Toggle Terminal (Ctrl+`)
        {
            id: "toggleTerminal",
            key: "`",
            ctrl: true,
            action: () => {
                toggleTerminal();
            },
        },
        // Close Settings Page (Escape)
        {
            id: "closeSettings",
            key: "Escape",
            action: () => {
                if (isSettingsPageOpen) {
                    closeSettingsPage();
                }
            },
        },
    ];

    const handleKeyDown = useCallback(
        (e: KeyboardEvent) => {
            for (const shortcut of shortcuts) {
                const ctrlMatch = shortcut.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
                const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
                const altMatch = shortcut.alt ? e.altKey : !e.altKey;
                const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

                if (ctrlMatch && shiftMatch && altMatch && keyMatch) {
                    e.preventDefault();
                    shortcut.action();
                    return;
                }
            }
        },
        [currentFile, currentFilePath, saveFile, openFolder, openCommandPalette, openSettingsPage, closeSettingsPage, isSettingsPageOpen, toggleSidebar, toggleAIPanel, toggleTerminal]
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    return {
        shortcuts,
    };
}
