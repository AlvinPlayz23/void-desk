// LSP Integration Hook
// Connects CodeMirror editor to Rust LSP backend

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useCallback, useRef } from "react";
import { useFileStore } from "@/stores/fileStore";

interface CompletionItem {
    label: string;
    kind?: string;
    detail?: string;
    insertText?: string;
}

interface HoverInfo {
    contents: string;
    range?: {
        start: { line: number; character: number };
        end: { line: number; character: number };
    };
}

// DiagnosticInfo will be used in Phase 2 for error squiggles
// interface DiagnosticInfo {
//     range: {
//         start: { line: number; character: number };
//         end: { line: number; character: number };
//     };
//     severity: number;
//     message: string;
//     source?: string;
// }

// Get language ID from file extension
function getLanguageFromPath(path: string): string {
    const ext = path.split(".").pop()?.toLowerCase() || "";
    const map: Record<string, string> = {
        ts: "typescript",
        tsx: "typescript",
        js: "javascript",
        jsx: "javascript",
        rs: "rust",
        py: "python",
    };
    return map[ext] || "plaintext";
}

export function useLsp() {
    const { rootPath } = useFileStore();
    const initializedRef = useRef(false);

    // Initialize LSP when workspace opens
    useEffect(() => {
        if (rootPath && !initializedRef.current) {
            initializedRef.current = true;
            console.log("[LSP] Setting root path:", rootPath);
            invoke("lsp_set_root", { rootPath })
                .then(() => console.log("[LSP] Root path set successfully"))
                .catch((err) => console.error("[LSP] Failed to set root:", err));
        }
    }, [rootPath]);

    // Notify LSP when a file is opened
    const didOpen = useCallback(async (path: string, content: string) => {
        const language = getLanguageFromPath(path);
        console.log("[LSP] didOpen called:", { path, language, contentLength: content.length });
        if (language === "plaintext") {
            console.log("[LSP] Skipping plaintext file");
            return;
        }

        try {
            await invoke("lsp_did_open", { path, content, language });
            console.log("[LSP] didOpen success");
        } catch (err) {
            console.error("[LSP] didOpen failed:", err);
        }
    }, []);

    // Notify LSP when a document changes
    const didChange = useCallback(async (path: string, content: string) => {
        const language = getLanguageFromPath(path);
        if (language === "plaintext") return;

        try {
            await invoke("lsp_did_change", { path, content, language });
        } catch (err) {
            console.error("[LSP] didChange failed:", err);
        }
    }, []);

    // Request completions at a position
    const getCompletions = useCallback(
        async (path: string, line: number, character: number): Promise<CompletionItem[]> => {
            const language = getLanguageFromPath(path);
            console.log("[LSP] getCompletions:", { path, line, character, language });
            if (language === "plaintext") return [];

            try {
                const result = await invoke<any>("lsp_completion", {
                    path,
                    line,
                    character,
                    language,
                });
                console.log("[LSP] completion result:", result);

                // Handle different completion response formats
                if (!result) return [];
                const items = result.items || result || [];
                return items.map((item: any) => ({
                    label: item.label,
                    kind: item.kind?.toString(),
                    detail: item.detail,
                    insertText: item.insertText || item.label,
                }));
            } catch (err) {
                console.error("[LSP] completion failed:", err);
                return [];
            }
        },
        []
    );

    // Request hover info at a position
    const getHover = useCallback(
        async (path: string, line: number, character: number): Promise<HoverInfo | null> => {
            const language = getLanguageFromPath(path);
            console.log("[LSP] getHover:", { path, line, character, language });
            if (language === "plaintext") return null;

            try {
                const result = await invoke<any>("lsp_hover", {
                    path,
                    line,
                    character,
                    language,
                });
                console.log("[LSP] hover result:", result);

                if (!result || !result.contents) return null;

                // Parse markdown content
                let contents = "";
                if (typeof result.contents === "string") {
                    contents = result.contents;
                } else if (result.contents.value) {
                    contents = result.contents.value;
                } else if (Array.isArray(result.contents)) {
                    contents = result.contents
                        .map((c: any) => (typeof c === "string" ? c : c.value))
                        .join("\n");
                }

                return { contents, range: result.range };
            } catch (err) {
                console.error("[LSP] hover failed:", err);
                return null;
            }
        },
        []
    );

    return {
        didOpen,
        didChange,
        getCompletions,
        getHover,
    };
}
