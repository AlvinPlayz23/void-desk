import { create } from "zustand";
import { normalizePath } from "@/utils/path";

export interface LspPosition {
    line: number;
    character: number;
}

export interface LspRange {
    start: LspPosition;
    end: LspPosition;
}

export interface LspDiagnostic {
    path: string;
    message: string;
    severity?: number | null;
    source?: string | null;
    code?: string | null;
    range: LspRange;
}

interface DiagnosticsState {
    diagnosticsByPath: Record<string, LspDiagnostic[]>;
    setDiagnosticsForPath: (path: string, diagnostics: LspDiagnostic[]) => void;
    hydrateDiagnostics: (diagnostics: LspDiagnostic[]) => void;
    clearDiagnostics: () => void;
}

export const useDiagnosticsStore = create<DiagnosticsState>((set) => ({
    diagnosticsByPath: {},

    setDiagnosticsForPath: (path, diagnostics) =>
        set((state) => ({
            diagnosticsByPath: diagnostics.length
                ? { ...state.diagnosticsByPath, [normalizePath(path)]: diagnostics.map((item) => ({ ...item, path: normalizePath(item.path) })) }
                : Object.fromEntries(
                      Object.entries(state.diagnosticsByPath).filter(([existingPath]) => existingPath !== normalizePath(path))
                  ),
        })),

    hydrateDiagnostics: (diagnostics) =>
        set({
            diagnosticsByPath: diagnostics.reduce<Record<string, LspDiagnostic[]>>((acc, diagnostic) => {
                const path = normalizePath(diagnostic.path);
                if (!acc[path]) {
                    acc[path] = [];
                }
                acc[path].push({ ...diagnostic, path });
                return acc;
            }, {}),
        }),

    clearDiagnostics: () => set({ diagnosticsByPath: {} }),
}));

export function getDiagnosticSeverityBucket(severity?: number | null) {
    if (severity === 1) return "error";
    if (severity === 2) return "warning";
    if (severity === 3) return "info";
    if (severity === 4) return "hint";
    return "warning";
}
