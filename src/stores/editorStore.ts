import { create } from "zustand";

interface EditorState {
    // Cursor & selection
    cursorLine: number;
    cursorColumn: number;
    selectionStart: { line: number; column: number } | null;
    selectionEnd: { line: number; column: number } | null;

    // View state
    scrollTop: number;
    pendingNavigation:
        | {
              path: string;
              line: number;
              column: number;
              endLine?: number;
              endColumn?: number;
          }
        | null;

    // Actions
    setCursor: (line: number, column: number) => void;
    setSelection: (
        start: { line: number; column: number } | null,
        end: { line: number; column: number } | null
    ) => void;
    setScrollTop: (top: number) => void;
    navigateTo: (
        target: {
            path: string;
            line: number;
            column: number;
            endLine?: number;
            endColumn?: number;
        } | null
    ) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
    cursorLine: 1,
    cursorColumn: 1,
    selectionStart: null,
    selectionEnd: null,
    scrollTop: 0,
    pendingNavigation: null,

    setCursor: (line, column) => set({ cursorLine: line, cursorColumn: column }),

    setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),

    setScrollTop: (top) => set({ scrollTop: top }),
    navigateTo: (target) => set({ pendingNavigation: target }),
}));
