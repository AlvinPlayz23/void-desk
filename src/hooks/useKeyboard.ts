import { useEffect, useCallback } from "react";
import { useFileStore } from "@/stores/fileStore";
import { useUIStore } from "@/stores/uiStore";
import { useFileSystem } from "./useFileSystem";

interface ShortcutHandler {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    action: () => void;
}

export function useKeyboard() {
    const { openFiles, currentFilePath } = useFileStore();
    const { openCommandPalette } = useUIStore();
    const { saveFile, openFolder } = useFileSystem();

    const currentFile = openFiles.find((f) => f.path === currentFilePath);

    // Define shortcuts
    const shortcuts: ShortcutHandler[] = [
        // Save file (Ctrl+S)
        {
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
            key: "o",
            ctrl: true,
            action: async () => {
                await openFolder();
            },
        },
        // Close tab (Ctrl+W)
        {
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
            key: "p",
            ctrl: true,
            shift: true,
            action: () => {
                openCommandPalette("command");
            },
        },
        // Quick File Open (Ctrl+P)
        {
            key: "p",
            ctrl: true,
            action: () => {
                openCommandPalette("file");
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
        [currentFile, currentFilePath, saveFile, openFolder, openCommandPalette]
    );

    useEffect(() => {
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [handleKeyDown]);

    return {
        shortcuts,
    };
}
