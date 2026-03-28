import { useEffect, useRef, useMemo, useCallback } from "react";
import { EditorSelection, EditorState, Extension } from "@codemirror/state";
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
import { useShallow } from "zustand/react/shallow";
import {
    search,
    searchKeymap,
    highlightSelectionMatches,
} from "@codemirror/search";
import { csharp } from "@replit/codemirror-lang-csharp";
import { svelte } from "@replit/codemirror-lang-svelte";
import { vscodeKeymap } from "@replit/codemirror-vscode-keymap";
import interact from "@replit/codemirror-interact";
import { showMinimap } from "@replit/codemirror-minimap";
import { useFileStore } from "@/stores/fileStore";
import { useEditorStore } from "@/stores/editorStore";
import { useSettingsStore } from "@/stores/settingsStore";
import { useUIStore } from "@/stores/uiStore";
import { useLsp } from "@/hooks/useLsp";
import { useInlineCompletion } from "@/hooks/useInlineCompletion";
import { ghostTextExtension, createGhostTextKeymap, setGhostText, clearGhostText, GhostTextCallbacks } from "./ghostText";
import { diagnosticsExtension, flashLineEffect, setDiagnosticsEffect } from "./diagnosticsExtension";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";
import { useNavigationStore } from "@/stores/navigationStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import { normalizePath, pathsEqual } from "@/utils/path";
import { useLspExtensionsStore } from "@/stores/lspExtensionsStore";
import { FileCode, Loader2 } from "lucide-react";

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

        // C#
        case "cs":
            return csharp();

        // Svelte
        case "svelte":
            return svelte();

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
        cs: "C#",
        svelte: "Svelte",
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
    const { openFiles, currentFilePath, updateFileContent } = useFileStore(
        useShallow((state) => ({
            openFiles: state.openFiles,
            currentFilePath: state.currentFilePath,
            updateFileContent: state.updateFileContent,
        }))
    );
    const { setCursor, pendingNavigation, navigateTo } = useEditorStore(
        useShallow((state) => ({
            setCursor: state.setCursor,
            pendingNavigation: state.pendingNavigation,
            navigateTo: state.navigateTo,
        }))
    );
    const { editorFontSize, editorFontFamily, tabSize, wordWrap, lineNumbers: showLineNumbers, minimap } = useSettingsStore(
        useShallow((state) => ({
            editorFontSize: state.editorFontSize,
            editorFontFamily: state.editorFontFamily,
            tabSize: state.tabSize,
            wordWrap: state.wordWrap,
            lineNumbers: state.lineNumbers,
            minimap: state.minimap,
        }))
    );
    const { appTheme, openSettingsPage } = useUIStore(
        useShallow((state) => ({
            appTheme: state.theme,
            openSettingsPage: state.openSettingsPage,
        }))
    );
    const { didOpen, didChange, getCompletions, getHover, getDefinition, getReferences, renameSymbol } = useLsp();
    const { completion, isLoading, requestCompletion, clearCompletion, acceptAll, acceptWord, hasCompletion } = useInlineCompletion();
    const diagnosticsByPath = useDiagnosticsStore((state) => state.diagnosticsByPath);
    const { setSymbolResults, clearSymbolResults } = useNavigationStore(
        useShallow((state) => ({
            setSymbolResults: state.setSymbolResults,
            clearSymbolResults: state.clearSymbolResults,
        }))
    );
    const { readFile, openFileAtLocation, reloadOpenFile } = useFileSystem();
    const extensions = useLspExtensionsStore((state) => state.extensions);
    const dismissedPromptIds = useLspExtensionsStore((state) => state.dismissedPromptIds);
    const dismissPrompt = useLspExtensionsStore((state) => state.dismissPrompt);

    const currentFile = openFiles.find((f) => pathsEqual(f.path, currentFilePath));
    const diagnostics = currentFile ? diagnosticsByPath[normalizePath(currentFile.path)] || [] : [];
    const currentExtension = currentFile?.path.split(".").pop()?.toLowerCase() || "";
    const missingExtension = currentExtension
        ? extensions.find(
              (extension) =>
                  extension.file_extensions.includes(currentExtension) &&
                  !extension.installed &&
                  !dismissedPromptIds.includes(extension.id)
          ) || null
        : null;

    // Use a ref for callbacks so the keymap always has access to current functions
    const ghostTextCallbacksRef = useRef<GhostTextCallbacks>({
        onAcceptAll: () => null,
        onAcceptWord: () => null,
        onDismiss: () => {},
        hasCompletion: () => false,
    });
    const lspCommandHandlersRef = useRef({
        goToDefinition: () => Promise.resolve(true),
        findReferences: () => Promise.resolve(true),
        renameSymbol: () => Promise.resolve(true),
    });

    // Keep the ref updated with current functions
    useEffect(() => {
        ghostTextCallbacksRef.current = {
            onAcceptAll: acceptAll,
            onAcceptWord: acceptWord,
            onDismiss: clearCompletion,
            hasCompletion,
        };
    }, [acceptAll, acceptWord, clearCompletion, hasCompletion]);

    // Create keymap once with ref - it will always use current callbacks
    const ghostTextKeymapExt = useMemo(
        () => createGhostTextKeymap(ghostTextCallbacksRef),
        []
    );

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

    const getCursorLspPosition = useCallback(() => {
        const view = viewRef.current;
        if (!view || !currentFile?.path) {
            return null;
        }

        const pos = view.state.selection.main.head;
        const line = view.state.doc.lineAt(pos);
        return {
            line: line.number - 1,
            character: pos - line.from,
        };
    }, [currentFile?.path]);

    const buildSymbolResults = useCallback(
        async (
            locations: {
                path: string;
                range: {
                    start: { line: number; character: number };
                    end: { line: number; character: number };
                };
            }[]
        ) => {
            const fileCache = new Map<string, string>();

            return Promise.all(
                locations.map(async (location) => {
                    let content = fileCache.get(location.path);
                    if (content === undefined) {
                        content = (await readFile(location.path)) || "";
                        fileCache.set(location.path, content);
                    }

                    const lines = content.split(/\r?\n/);
                    const lineText = lines[location.range.start.line] || "";
                    return {
                        ...location,
                        lineText,
                        preview: lineText.trim(),
                    };
                })
            );
        },
        [readFile]
    );

    const openLocationsPanel = useCallback(
        async (
            mode: "definition" | "references",
            locations: { path: string; range: { start: { line: number; character: number }; end: { line: number; character: number } } }[]
        ) => {
            const results = await buildSymbolResults(locations);
            setSymbolResults(mode, results);
            useUIStore.getState().openSidebar();
            useUIStore.getState().setSidebarView("symbols");
        },
        [buildSymbolResults, setSymbolResults]
    );

    const handleGoToDefinition = useCallback(async () => {
        if (!currentFile?.path) return true;

        const position = getCursorLspPosition();
        if (!position) return true;

        const locations = await getDefinition(currentFile.path, position.line, position.character);
        if (locations.length === 0) {
            return true;
        }

        if (locations.length === 1) {
            const location = locations[0];
            const name = location.path.split(/[\\/]/).pop() || location.path;
            await openFileAtLocation(
                location.path,
                name,
                location.range.start.line + 1,
                location.range.start.character + 1,
                location.range.end.line + 1,
                location.range.end.character + 1
            );
            clearSymbolResults();
            return true;
        }

        await openLocationsPanel("definition", locations);
        return true;
    }, [clearSymbolResults, currentFile?.path, getCursorLspPosition, getDefinition, openFileAtLocation, openLocationsPanel]);

    const handleFindReferences = useCallback(async () => {
        if (!currentFile?.path) return true;

        const position = getCursorLspPosition();
        if (!position) return true;

        const locations = await getReferences(currentFile.path, position.line, position.character);
        await openLocationsPanel("references", locations);
        return true;
    }, [currentFile?.path, getCursorLspPosition, getReferences, openLocationsPanel]);

    const handleRenameSymbol = useCallback(async () => {
        if (!currentFile?.path) return true;

        const dirtyFiles = openFiles.filter((file) => file.isDirty);
        if (dirtyFiles.length > 0) {
            window.alert("Save all open files before renaming a symbol.");
            return true;
        }

        const position = getCursorLspPosition();
        if (!position) return true;

        const newName = window.prompt("Rename symbol to:");
        if (!newName?.trim()) {
            return true;
        }

        const result = await renameSymbol(
            currentFile.path,
            position.line,
            position.character,
            newName.trim()
        );

        if (!result) {
            return true;
        }

        await Promise.all(
            result.files
                .filter((path) => openFiles.some((file) => file.path === path))
                .map((path) => reloadOpenFile(path))
        );

        return true;
    }, [currentFile?.path, getCursorLspPosition, openFiles, reloadOpenFile, renameSymbol]);

    useEffect(() => {
        lspCommandHandlersRef.current = {
            goToDefinition: handleGoToDefinition,
            findReferences: handleFindReferences,
            renameSymbol: handleRenameSymbol,
        };
    }, [handleFindReferences, handleGoToDefinition, handleRenameSymbol]);

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
                clearCompletion(); // Clear ghost text on any edit

                // Request inline completion
                const pos = update.state.selection.main.head;
                const language = getLanguageName(currentFile.path);
                requestCompletion(content, pos, currentFile.path, language);
            }

            // Update cursor position
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            setCursor(line.number, pos - line.from + 1);
        });

        const state = EditorState.create({
            doc: currentFile.content,
            extensions: [
                showLineNumbers ? lineNumbers() : [],
                highlightActiveLineGutter(),
                highlightSpecialChars(),
                history(),
                foldGutter(),
                drawSelection(),
                dropCursor(),
                EditorState.allowMultipleSelections.of(true),
                indentOnInput(),
                EditorState.tabSize.of(tabSize),
                syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
                bracketMatching(),
                closeBrackets(),
                rectangularSelection(),
                crosshairCursor(),
                highlightActiveLine(),
                wordWrap ? EditorView.lineWrapping : [],
                languageExtension, // Dynamic language based on file extension
                // Only use oneDark theme for dark/obsidian themes
                appTheme !== "light" ? oneDark : [],
                // LSP-powered features
                lspCompletionSource ? autocompletion({
                    override: [lspCompletionSource],
                    activateOnTyping: true,
                }) : [],
                lspHoverTooltip,
                diagnosticsExtension(),
                // Ghost text (inline AI completions)
                ghostTextExtension(),
                ghostTextKeymapExt,
                search({
                    top: true, // Show search panel at top of editor
                }),
                highlightSelectionMatches(),
                // Interact extension with number dragger
                interact({
                    rules: [
                        {
                            regexp: /-?\b\d+\.?\d*\b/g,
                            cursor: "ew-resize",
                            onDrag: (text, setText, e) => {
                                const newVal = Number(text) + e.movementX;
                                if (isNaN(newVal)) return;
                                setText(newVal.toString());
                            },
                        }
                    ],
                }),
                // Minimap (conditionally enabled)
                minimap ? showMinimap.compute(['doc'], () => {
                    return {
                        create: () => {
                            const dom = document.createElement('div');
                            return { dom };
                        },
                        displayText: 'blocks',
                        showOverlay: 'always',
                    };
                }) : [],
                // Keymaps
                keymap.of([
                    ...vscodeKeymap,
                    ...closeBracketsKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                    indentWithTab,
                    {
                        key: "F12",
                        run: () => {
                            void lspCommandHandlersRef.current.goToDefinition();
                            return true;
                        },
                    },
                    {
                        key: "Shift-F12",
                        run: () => {
                            void lspCommandHandlersRef.current.findReferences();
                            return true;
                        },
                    },
                    {
                        key: "F2",
                        run: () => {
                            void lspCommandHandlersRef.current.renameSymbol();
                            return true;
                        },
                    },
                ]),
                updateListener,
                EditorView.theme({
                    "&": {
                        height: "100%",
                        backgroundColor: "var(--editor-bg, var(--color-surface-base))",
                    },
                    "&.cm-focused": {
                        outline: "none",
                    },
                    ".cm-scroller": {
                        backgroundColor: "var(--editor-bg, var(--color-surface-base))",
                    },
                    ".cm-content": {
                        backgroundColor: "transparent",
                        caretColor: "var(--color-accent-primary)",
                        fontFamily: `'${editorFontFamily}', var(--font-mono)`,
                        fontSize: `${editorFontSize}px`,
                        padding: "8px 0",
                    },
                    ".cm-gutters": {
                        backgroundColor: "var(--color-surface-elevated)",
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
    }, [currentFile?.path, editorFontSize, editorFontFamily, tabSize, wordWrap, showLineNumbers, minimap, appTheme]); // Reinit when file, settings, or theme change

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

    useEffect(() => {
        if (!viewRef.current) return;

        viewRef.current.dispatch({
            effects: setDiagnosticsEffect.of(diagnostics),
        });
    }, [diagnostics]);

    useEffect(() => {
        if (!viewRef.current || !currentFile || !pendingNavigation || pendingNavigation.path !== currentFile.path) {
            return;
        }

        const doc = viewRef.current.state.doc;
        const startLine = Math.max(1, pendingNavigation.line);
        const startLineInfo = doc.line(Math.min(startLine, doc.lines));
        const anchor = Math.min(
            startLineInfo.from + Math.max(0, pendingNavigation.column - 1),
            startLineInfo.to
        );

        let head = anchor;
        if (pendingNavigation.endLine && pendingNavigation.endColumn) {
            const endLineInfo = doc.line(Math.min(Math.max(1, pendingNavigation.endLine), doc.lines));
            head = Math.min(
                endLineInfo.from + Math.max(0, pendingNavigation.endColumn - 1),
                endLineInfo.to
            );
        }

        viewRef.current.dispatch({
            selection: EditorSelection.range(anchor, head),
            effects: flashLineEffect.of(startLine),
            scrollIntoView: true,
        });
        viewRef.current.focus();
        navigateTo(null);

        const timeout = window.setTimeout(() => {
            viewRef.current?.dispatch({
                effects: flashLineEffect.of(null),
            });
        }, 1400);

        return () => window.clearTimeout(timeout);
    }, [currentFile?.path, navigateTo, pendingNavigation]);

    // Update ghost text when completion changes
    useEffect(() => {
        if (!viewRef.current) return;

        const view = viewRef.current;
        const pos = view.state.selection.main.head;

        if (completion) {
            view.dispatch({
                effects: setGhostText.of({ text: completion, pos }),
            });
        } else {
            view.dispatch({
                effects: clearGhostText.of(undefined),
            });
        }
    }, [completion]);

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
        <div className="relative h-full w-full">
            {missingExtension && (
                <div className="absolute top-2 left-3 right-3 z-20 flex items-center gap-3 rounded-lg border border-[var(--color-border-default)] bg-[var(--color-surface-overlay)]/95 px-3 py-2 shadow-lg backdrop-blur">
                    <div className="flex-1 min-w-0">
                        <div className="text-xs font-semibold text-[var(--color-text-primary)]">
                            {missingExtension.name} is not installed
                        </div>
                        <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                            Install this language server from Settings → Extensions to enable IDE features for
                            .{currentExtension} files.
                        </div>
                    </div>
                    <button
                        onClick={() => openSettingsPage("extensions")}
                        className="px-2.5 py-1 text-[11px] rounded-md bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                    >
                        Open Extensions
                    </button>
                    <button
                        onClick={() => dismissPrompt(missingExtension.id)}
                        className="px-2 py-1 text-[11px] rounded-md border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
                    >
                        Dismiss
                    </button>
                </div>
            )}
            <div
                ref={editorRef}
                className="h-full w-full overflow-hidden"
            />
            {isLoading && (
                <div className="absolute bottom-2 right-2 flex items-center gap-1.5 bg-[var(--color-void-800,#1a1a1a)] border border-[var(--color-border-subtle,#333)] rounded px-2 py-1 text-xs text-[var(--color-text-tertiary,#666)] shadow-lg">
                    <Loader2 className="w-3 h-3 animate-spin" />
                    <span>AI thinking...</span>
                </div>
            )}
        </div>
    );
}
