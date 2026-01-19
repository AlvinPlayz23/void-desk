import { useEffect, useRef } from "react";
import { EditorState } from "@codemirror/state";
import {
    EditorView,
    keymap,
    lineNumbers,
    highlightActiveLine,
    highlightActiveLineGutter,
    drawSelection,
    dropCursor,
    rectangularSelection,
    crosshairCursor,
    highlightSpecialChars,
} from "@codemirror/view";
import {
    defaultKeymap,
    history,
    historyKeymap,
    indentWithTab,
} from "@codemirror/commands";
import {
    syntaxHighlighting,
    defaultHighlightStyle,
    bracketMatching,
    foldGutter,
    indentOnInput,
} from "@codemirror/language";
import { javascript } from "@codemirror/lang-javascript";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import { useFileStore } from "@/stores/fileStore";
import { useEditorStore } from "@/stores/editorStore";
import { FileCode } from "lucide-react";

export function CodeEditor() {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView>();
    const { openFiles, currentFilePath, updateFileContent } = useFileStore();
    const { setCursor } = useEditorStore();

    const currentFile = openFiles.find((f) => f.path === currentFilePath);

    // Initialize or update editor
    useEffect(() => {
        if (!editorRef.current) return;

        // Destroy existing view
        if (viewRef.current) {
            viewRef.current.destroy();
        }

        if (!currentFile) {
            return;
        }

        const updateListener = EditorView.updateListener.of((update) => {
            if (update.docChanged) {
                const content = update.state.doc.toString();
                updateFileContent(currentFile.path, content);
            }

            // Update cursor position
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            setCursor(line.number, pos - line.from + 1);
        });

        const state = EditorState.create({
            doc: currentFile.content,
            extensions: [
                lineNumbers(),
                highlightActiveLineGutter(),
                highlightSpecialChars(),
                history(),
                foldGutter(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                bracketMatching(),
                closeBrackets(),
                rectangularSelection(),
                crosshairCursor(),
                highlightActiveLine(),
                javascript({ jsx: true, typescript: true }),
                oneDark,
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    indentWithTab,
                ]),
                updateListener,
                EditorView.theme({
                    "&": {
                        height: "100%",
                        backgroundColor: "var(--color-surface-base)",
                    },
                    ".cm-content": {
                        fontFamily: "var(--font-mono)",
                        fontSize: "13px",
                        padding: "8px 0",
                    },
                    ".cm-line": {
                        padding: "0 16px",
                    },
                }),
            ],
        });

        const view = new EditorView({
            state,
            parent: editorRef.current,
        });

        viewRef.current = view;

        return () => {
            view.destroy();
        };
    }, [currentFile?.path]); // Only reinit when file changes

    // Update content when file content changes externally
    useEffect(() => {
        if (!viewRef.current || !currentFile) return;

        const currentContent = viewRef.current.state.doc.toString();
        if (currentContent !== currentFile.content && !currentFile.isDirty) {
            viewRef.current.dispatch({
                changes: {
                    from: 0,
                    to: currentContent.length,
                    insert: currentFile.content,
                },
            });
        }
    }, [currentFile?.content]);

    if (!currentFile) {
        return (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-[var(--color-text-tertiary)]">
                <FileCode className="w-16 h-16 opacity-20" />
                <div className="text-center">
                    <p className="text-lg font-medium">No file open</p>
                    <p className="text-sm mt-1 opacity-60">
                        Select a file from the explorer to start editing
                    </p>
                </div>
            </div>
        );
    }

    return (
        <div
            ref={editorRef}
            className="h-full w-full overflow-hidden"
        />
    );
}
