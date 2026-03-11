import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useFileStore } from "@/stores/fileStore";

interface SearchMatch {
    id: string;
    line: number;
    column: number;
    line_text: string;
    match_text: string;
    start_byte: number;
    end_byte: number;
    before: string[];
    after: string[];
    replacement_preview: string | null;
}

interface FileSearchResult {
    path: string;
    matches: SearchMatch[];
}

interface SearchResponse {
    files: FileSearchResult[];
    total_matches: number;
    truncated: boolean;
}

interface ReplaceResponse {
    files_changed: number;
    replacements_applied: number;
    errors: { path: string; message: string }[];
}

interface SearchState {
    query: string;
    replaceText: string;
    isRegex: boolean;
    caseSensitive: boolean;
    filePattern: string;
    results: SearchResponse | null;
    isSearching: boolean;
    error: string | null;
    selectedMatches: Record<string, boolean>;
    expandedFiles: Record<string, boolean>;
    showReplace: boolean;

    setQuery: (query: string) => void;
    setReplaceText: (text: string) => void;
    setIsRegex: (value: boolean) => void;
    setCaseSensitive: (value: boolean) => void;
    setFilePattern: (pattern: string) => void;
    setShowReplace: (show: boolean) => void;

    runSearch: () => Promise<void>;
    clearResults: () => void;

    toggleMatch: (id: string) => void;
    toggleFileMatches: (path: string) => void;
    selectAll: () => void;
    deselectAll: () => void;
    toggleFileExpanded: (path: string) => void;

    replaceSelected: () => Promise<void>;
    replaceAll: () => Promise<void>;
}

export const useSearchStore = create<SearchState>()((set, get) => ({
    query: "",
    replaceText: "",
    isRegex: false,
    caseSensitive: false,
    filePattern: "",
    results: null,
    isSearching: false,
    error: null,
    selectedMatches: {},
    expandedFiles: {},
    showReplace: false,

    setQuery: (query) => set({ query }),
    setReplaceText: (text) => set({ replaceText: text }),
    setIsRegex: (value) => set({ isRegex: value }),
    setCaseSensitive: (value) => set({ caseSensitive: value }),
    setFilePattern: (pattern) => set({ filePattern: pattern }),
    setShowReplace: (show) => set({ showReplace: show }),

    runSearch: async () => {
        const { query, isRegex, caseSensitive, filePattern } = get();
        if (!query.trim()) return;

        const rootPath = useFileStore.getState().rootPath;
        if (!rootPath) return;

        const parts = filePattern.split(",").map((s) => s.trim()).filter(Boolean);
        const includeGlobs: string[] = [];
        const excludeGlobs: string[] = [];
        for (const part of parts) {
            if (part.startsWith("!")) {
                excludeGlobs.push(part.slice(1));
            } else {
                includeGlobs.push(part);
            }
        }

        set({ isSearching: true, error: null });

        try {
            const replaceText = get().showReplace ? get().replaceText : undefined;
            const results = await invoke<SearchResponse>("search_in_files", {
                rootPath,
                options: {
                    query,
                    is_regex: isRegex,
                    case_sensitive: caseSensitive,
                    include_globs: includeGlobs,
                    exclude_globs: excludeGlobs,
                    context_lines: 1,
                    max_results: 10000,
                    max_file_size_bytes: 2097152,
                },
                replace: replaceText || null,
            });

            const expandedFiles: Record<string, boolean> = {};
            const selectedMatches: Record<string, boolean> = {};
            for (const file of results.files) {
                expandedFiles[file.path] = true;
                for (const match of file.matches) {
                    selectedMatches[match.id] = true;
                }
            }

            set({ results, isSearching: false, expandedFiles, selectedMatches });
        } catch (error) {
            set({ error: String(error), isSearching: false });
        }
    },

    clearResults: () => set({ results: null, selectedMatches: {}, expandedFiles: {}, error: null }),

    toggleMatch: (id) => {
        const selected = { ...get().selectedMatches };
        selected[id] = !selected[id];
        set({ selectedMatches: selected });
    },

    toggleFileMatches: (path) => {
        const { results, selectedMatches } = get();
        if (!results) return;
        const file = results.files.find((f) => f.path === path);
        if (!file) return;

        const allSelected = file.matches.every((m) => selectedMatches[m.id]);
        const newSelected = { ...selectedMatches };
        for (const match of file.matches) {
            newSelected[match.id] = !allSelected;
        }
        set({ selectedMatches: newSelected });
    },

    selectAll: () => {
        const { results } = get();
        if (!results) return;
        const selected: Record<string, boolean> = {};
        for (const file of results.files) {
            for (const match of file.matches) {
                selected[match.id] = true;
            }
        }
        set({ selectedMatches: selected });
    },

    deselectAll: () => set({ selectedMatches: {} }),

    toggleFileExpanded: (path) => {
        const expanded = { ...get().expandedFiles };
        expanded[path] = !expanded[path];
        set({ expandedFiles: expanded });
    },

    replaceSelected: async () => {
        const { results, selectedMatches, replaceText } = get();
        if (!results) return;

        const selections: { path: string; start_byte: number; end_byte: number; match_text: string; replacement_text: string }[] = [];
        for (const file of results.files) {
            for (const match of file.matches) {
                if (selectedMatches[match.id]) {
                    selections.push({
                        path: file.path,
                        start_byte: match.start_byte,
                        end_byte: match.end_byte,
                        match_text: match.match_text,
                        replacement_text: match.replacement_preview || replaceText,
                    });
                }
            }
        }

        if (selections.length === 0) return;

        set({ isSearching: true });
        try {
            await invoke<ReplaceResponse>("replace_in_files", { selections });
            await get().runSearch();
        } catch (error) {
            set({ error: String(error), isSearching: false });
        }
    },

    replaceAll: async () => {
        get().selectAll();
        await get().replaceSelected();
    },
}));
