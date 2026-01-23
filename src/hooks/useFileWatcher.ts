import { useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useFileStore } from "@/stores/fileStore";

interface FileChangeEvent {
    event_type: "create" | "modify" | "remove";
    paths: string[];
}

interface TauriFileNode {
    path: string;
    name: string;
    is_dir: boolean;
    children?: TauriFileNode[];
}

// Convert Tauri response to our FileNode format
function convertToFileNode(node: TauriFileNode): import("@/stores/fileStore").FileNode {
    return {
        path: node.path,
        name: node.name,
        isDir: node.is_dir,
        isExpanded: false,
        children: node.children?.map(convertToFileNode),
    };
}

/**
 * Hook to manage file system watching.
 * Automatically starts watching when a project is opened and stops when closed.
 * Refreshes the file tree when external changes are detected.
 */
export function useFileWatcher() {
    const { rootPath, setFileTree } = useFileStore();
    const unlistenRef = useRef<UnlistenFn | null>(null);
    const isWatchingRef = useRef(false);

    // Refresh file tree (duplicated here to avoid circular deps)
    const refreshFileTree = useCallback(async (path: string) => {
        try {
            const tree = await invoke<TauriFileNode[]>("get_project_tree", {
                path,
                maxDepth: 5,
            });
            const fileNodes = tree.map(convertToFileNode);
            setFileTree(fileNodes);
        } catch (error) {
            console.error("Failed to refresh file tree:", error);
        }
    }, [setFileTree]);

    // Start watching a directory
    const startWatching = useCallback(async (path: string) => {
        if (isWatchingRef.current) {
            await stopWatching();
        }

        try {
            // Set up event listener first
            unlistenRef.current = await listen<FileChangeEvent>("file-change", (event) => {
                console.log("File change detected:", event.payload);
                // Refresh the file tree when changes are detected
                if (rootPath) {
                    refreshFileTree(rootPath);
                }
            });

            // Start the watcher
            await invoke("start_file_watcher", { path });
            isWatchingRef.current = true;
            console.log("File watcher started for:", path);
        } catch (error) {
            console.error("Failed to start file watcher:", error);
        }
    }, [rootPath, refreshFileTree]);

    // Stop watching
    const stopWatching = useCallback(async () => {
        try {
            if (unlistenRef.current) {
                unlistenRef.current();
                unlistenRef.current = null;
            }
            await invoke("stop_file_watcher");
            isWatchingRef.current = false;
            console.log("File watcher stopped");
        } catch (error) {
            console.error("Failed to stop file watcher:", error);
        }
    }, []);

    // Auto-start/stop watching based on rootPath
    useEffect(() => {
        if (rootPath) {
            startWatching(rootPath);
        } else {
            stopWatching();
        }

        // Cleanup on unmount
        return () => {
            stopWatching();
        };
    }, [rootPath, startWatching, stopWatching]);

    return {
        startWatching,
        stopWatching,
        isWatching: isWatchingRef.current,
    };
}

