import { useEffect, useRef, useMemo } from "react";
import { EditorState, Extension } from "@codemirror/state";
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
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { closeBrackets, closeBracketsKeymap, autocompletion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";
import { hoverTooltip, Tooltip } from "@codemirror/view";
import { oneDark } from "@codemirror/theme-one-dark";
import {
    search,
    searchKeymap,
    highlightSelectionMatches,
} from "@codemirror/search";
import { useFileStore } from "@/stores/fileStore";
import { useEditorStore } from "@/stores/editorStore";
import { useLsp } from "@/hooks/useLsp";
import { FileCode } from "lucide-react";

/**
 * Get the appropriate CodeMirror language extension based on file extension
 */
function getLanguageExtension(filePath: string): Extension {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";

    switch (ext) {
        // JavaScript/TypeScript
        case "js":
        case "jsx":
            return javascript({ jsx: true });
        case "ts":
        case "tsx":
            return javascript({ jsx: true, typescript: true });
        case "mjs":
        case "cjs":
            return javascript();

        // Python
        case "py":
        case "pyw":
        case "pyi":
            return python();

        // Rust
        case "rs":
            return rust();

        // HTML
        case "html":
        case "htm":
        case "xhtml":
            return html();

        // CSS
        case "css":
            return css();
        case "scss":
        case "sass":
        case "less":
            return css(); // Basic CSS highlighting for preprocessors

        // JSON
        case "json":
        case "jsonc":
            return json();

        // Markdown
        case "md":
        case "markdown":
        case "mdx":
            return markdown();

        // Config files (often JSON-like or plain text)
        case "toml":
        case "yaml":
        case "yml":
            return []; // No specific extension, use plain text

        // Default: no language extension (plain text)
        default:
            return [];
    }
}

/**
 * Get a human-readable language name for the status bar
 */
export function getLanguageName(filePath: string): string {
    const ext = filePath.split(".").pop()?.toLowerCase() || "";

    const languageNames: Record<string, string> = {
        js: "JavaScript",
        jsx: "JavaScript (JSX)",
        ts: "TypeScript",
        tsx: "TypeScript (TSX)",
        mjs: "JavaScript (ESM)",
        cjs: "JavaScript (CJS)",
        py: "Python",
        pyw: "Python",
        pyi: "Python (Stub)",
        rs: "Rust",
        html: "HTML",
        htm: "HTML",
        xhtml: "XHTML",
        css: "CSS",
        scss: "SCSS",
        sass: "Sass",
        less: "Less",
        json: "JSON",
        jsonc: "JSON with Comments",
        md: "Markdown",
        markdown: "Markdown",
        mdx: "MDX",
        toml: "TOML",
        yaml: "YAML",
        yml: "YAML",
        txt: "Plain Text",
    };

    return languageNames[ext] || "Plain Text";
}

export function CodeEditor() {
    const editorRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView>();
    const { openFiles, currentFilePath, updateFileContent } = useFileStore();
    const { setCursor } = useEditorStore();
    const { didOpen, didChange, getCompletions, getHover } = useLsp();

    const currentFile = openFiles.find((f) => f.path === currentFilePath);

    // Debounced sync for LSP
    const syncLsp = useMemo(() => {
        let timeout: ReturnType<typeof setTimeout>;
        return (path: string, content: string) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => {
                didChange(path, content);
            }, 300);
        };
    }, [didChange]);

    // Get the language extension based on file path
    const languageExtension = useMemo(() => {
        if (!currentFile?.path) return [];
        return getLanguageExtension(currentFile.path);
    }, [currentFile?.path]);

    // Notify LSP when file is opened
    useEffect(() => {
        if (currentFile?.path && currentFile?.content !== undefined) {
            didOpen(currentFile.path, currentFile.content);
        }
    }, [currentFile?.path, didOpen]);

    // Create LSP completion source
    const lspCompletionSource = useMemo(() => {
        if (!currentFile?.path) return null;
        const filePath = currentFile.path;

        return async (context: CompletionContext): Promise<CompletionResult | null> => {
            const pos = context.pos;
            const line = context.state.doc.lineAt(pos);
            const lineNum = line.number - 1; // LSP uses 0-based lines
            const character = pos - line.from;

            // Only trigger on explicit completion or after typing identifier chars
            if (!context.explicit && !context.matchBefore(/\w+$/)) {
                return null;
            }

            try {
                const items = await getCompletions(filePath, lineNum, character);
                if (!items.length) return null;

                return {
                    from: context.matchBefore(/\w*$/)?.from ?? pos,
                    options: items.map(item => ({
                        label: item.label,
                        type: item.kind || "text",
                        detail: item.detail,
                        apply: item.insertText || item.label,
                    })),
                };
            } catch {
                return null;
            }
        };
    }, [currentFile?.path, getCompletions]);

    // Create LSP hover tooltip
    const lspHoverTooltip = useMemo(() => {
        if (!currentFile?.path) return [];
        const filePath = currentFile.path;

        return hoverTooltip(async (view, pos): Promise<Tooltip | null> => {
            const line = view.state.doc.lineAt(pos);
            const lineNum = line.number - 1;
            const character = pos - line.from;

            try {
                const hover = await getHover(filePath, lineNum, character);
                if (!hover || !hover.contents) return null;

                return {
                    pos,
                    create: () => {
                        const dom = document.createElement("div");
                        dom.className = "lsp-hover-tooltip";
                        dom.style.cssText = "padding: 8px 12px; max-width: 400px; font-size: 12px; background: var(--color-void-800); border: 1px solid var(--color-border-subtle); border-radius: 6px;";
                        dom.innerHTML = `<pre style="margin:0; white-space: pre-wrap; font-family: var(--font-mono);">${hover.contents}</pre>`;
                        return { dom };
                    },
                };
            } catch {
                return null;
            }
        });
    }, [currentFile?.path, getHover]);

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
                syncLsp(currentFile.path, content); // Sync LSP when doc changes
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
                languageExtension, // Dynamic language based on file extension
                oneDark,
                // LSP-powered features
                lspCompletionSource ? autocompletion({
                    override: [lspCompletionSource],
                    activateOnTyping: true,
                }) : [],
                lspHoverTooltip,
                search({
                    top: true, // Show search panel at top of editor
                }),
                highlightSelectionMatches(),
                keymap.of([
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
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
