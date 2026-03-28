import { create } from "zustand";

import type { LspRange } from "@/stores/diagnosticsStore";

export interface LspLocation {
    path: string;
    range: LspRange;
}

export interface SymbolResultItem extends LspLocation {
    preview: string;
    lineText: string;
}

interface NavigationState {
    symbolResults: SymbolResultItem[];
    symbolMode: "definition" | "references" | null;
    symbolQuery: string;
    setSymbolResults: (
        mode: "definition" | "references",
        results: SymbolResultItem[],
        query?: string
    ) => void;
    clearSymbolResults: () => void;
}

export const useNavigationStore = create<NavigationState>((set) => ({
    symbolResults: [],
    symbolMode: null,
    symbolQuery: "",

    setSymbolResults: (mode, results, query = "") =>
        set({
            symbolResults: results,
            symbolMode: mode,
            symbolQuery: query,
        }),

    clearSymbolResults: () =>
        set({
            symbolResults: [],
            symbolMode: null,
            symbolQuery: "",
        }),
}));
