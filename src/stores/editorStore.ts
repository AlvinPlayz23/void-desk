import { create } from "zustand";

interface EditorState {
    // Cursor & selection
    cursorLine: number;
    cursorColumn: number;
    selectionStart: { line: number; column: number } | null;
    selectionEnd: { line: number; column: number } | null;

    // View state
    scrollTop: number;

    // Actions
    setCursor: (line: number, column: number) => void;
    setSelection: (
        start: { line: number; column: number } | null,
        end: { line: number; column: number } | null
    ) => void;
    setScrollTop: (top: number) => void;
}

export const useEditorStore = create<EditorState>((set) => ({
    cursorLine: 1,
    cursorColumn: 1,
    selectionStart: null,
    selectionEnd: null,
    scrollTop: 0,

    setCursor: (line, column) => set({ cursorLine: line, cursorColumn: column }),

    setSelection: (start, end) => set({ selectionStart: start, selectionEnd: end }),

    setScrollTop: (top) => set({ scrollTop: top }),
}));
