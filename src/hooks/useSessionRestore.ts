import { useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useFileStore } from "@/stores/fileStore";

function getLanguageFromFilename(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
        ts: "TypeScript",
        tsx: "TypeScript (TSX)",
        js: "JavaScript",
        jsx: "JavaScript (JSX)",
        json: "JSON",
        css: "CSS",
        html: "HTML",
        py: "Python",
        rs: "Rust",
        md: "Markdown",
        toml: "TOML",
        yaml: "YAML",
        yml: "YAML",
        go: "Go",
        java: "Java",
        c: "C",
        cpp: "C++",
        txt: "Plain Text",
    };
    return languageMap[ext || ""] || "Plain Text";
}

export function useSessionRestore() {
    const hasRestored = useRef(false);

    useEffect(() => {
        if (hasRestored.current) return;
        hasRestored.current = true;

        const restore = async () => {
            const state = useFileStore.getState();
            const { rootPath, sessionOpenFiles, sessionCurrentFilePath } = state;

            if (!rootPath) return;

            try {
                const tree = await invoke<any[]>("get_project_tree", {
                    path: rootPath,
                    maxDepth: 5,
                });

                const convertToFileNode = (node: any): any => ({
                    path: node.path,
                    name: node.name,
                    isDir: node.is_dir,
                    isExpanded: false,
                    children: node.children?.map(convertToFileNode),
                });

                state.setFileTree(tree.map(convertToFileNode));

                for (const sessionFile of sessionOpenFiles) {
                    try {
                        const content = await invoke<string>("read_file", { path: sessionFile.path });
                        state.openFile({
                            path: sessionFile.path,
                            name: sessionFile.name,
                            content,
                            isDirty: false,
                            language: sessionFile.language || getLanguageFromFilename(sessionFile.name),
                        });
                    } catch {
                        // File may have been deleted — skip silently
                    }
                }

                if (sessionCurrentFilePath) {
                    const openFiles = useFileStore.getState().openFiles;
                    if (openFiles.some((f) => f.path === sessionCurrentFilePath)) {
                        state.setCurrentFile(sessionCurrentFilePath);
                    }
                }

                state.addRecentProject(rootPath);
            } catch {
                // Project folder may no longer exist
            }
        };

        // Small delay to allow Zustand to rehydrate from localStorage
        setTimeout(restore, 100);
    }, []);
}
