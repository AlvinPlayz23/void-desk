import { create } from "zustand";
import { persist } from "zustand/middleware";
import { normalizePath, pathsEqual } from "@/utils/path";

export interface FileNode {
    path: string;
    name: string;
    isDir: boolean;
    children?: FileNode[];
    isExpanded?: boolean;
}

export interface OpenFile {
    path: string;
    name: string;
    content: string;
    isDirty: boolean;
    language: string;
}

// Helper to flatten tree for range selection
function flattenTree(nodes: FileNode[]): string[] {
    const result: string[] = [];
    for (const node of nodes) {
        result.push(node.path);
        if (node.isDir && node.isExpanded && node.children) {
            result.push(...flattenTree(node.children));
        }
    }
    return result;
}

interface FileState {
    // Project structure
    rootPath: string | null;
    fileTree: FileNode[];

    // Open files
    openFiles: OpenFile[];
    currentFilePath: string | null;

    // Multi-select state
    selectedPaths: string[];
    lastSelectedPath: string | null;
    draggedPaths: string[];

    // Recent projects
    recentProjects: { path: string; name: string; lastOpenedAt: number }[];
    addRecentProject: (path: string) => void;
    removeRecentProject: (path: string) => void;
    clearRecentProjects: () => void;

    // Session restore
    sessionOpenFiles: { path: string; name: string; language: string }[];
    sessionCurrentFilePath: string | null;
    saveSession: () => void;

    // Actions
    setRootPath: (path: string) => void;
    setFileTree: (tree: FileNode[]) => void;
    toggleFolder: (path: string) => void;

    openFile: (file: OpenFile) => void;
    closeFile: (path: string) => void;
    setCurrentFile: (path: string) => void;
    updateFileContent: (path: string, content: string) => void;
    replaceFileContent: (path: string, content: string, isDirty?: boolean) => void;
    markFileSaved: (path: string) => void;

    // Multi-select actions
    setSelectedPaths: (paths: string[]) => void;
    toggleSelection: (path: string) => void;
    selectRange: (endPath: string) => void;
    clearSelection: () => void;
    setDraggedPaths: (paths: string[]) => void;
    clearDraggedPaths: () => void;
}

export const useFileStore = create<FileState>()(
    persist(
        (set, get) => ({
            rootPath: null,
            fileTree: [],
            openFiles: [],
            currentFilePath: null,
            selectedPaths: [],
            lastSelectedPath: null,
            draggedPaths: [],

            // Recent projects
            recentProjects: [],

            // Session restore
            sessionOpenFiles: [],
            sessionCurrentFilePath: null,

            saveSession: () => {
                const { openFiles, currentFilePath } = get();
                set({
                    sessionOpenFiles: openFiles.map((f) => ({
                        path: f.path,
                        name: f.name,
                        language: f.language,
                    })),
                    sessionCurrentFilePath: currentFilePath,
                });
            },

            addRecentProject: (path) => {
                const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
                const { recentProjects } = get();
                const filtered = recentProjects.filter((p) => p.path !== path);
                const updated = [{ path, name, lastOpenedAt: Date.now() }, ...filtered].slice(0, 10);
                set({ recentProjects: updated });
            },

            removeRecentProject: (path) => {
                set({ recentProjects: get().recentProjects.filter((p) => p.path !== path) });
            },

            clearRecentProjects: () => set({ recentProjects: [] }),

            setRootPath: (path) => set({ rootPath: normalizePath(path) }),

            setFileTree: (tree) => set({ fileTree: tree }),

            toggleFolder: (path) => {
                const toggleNode = (nodes: FileNode[]): FileNode[] => {
                    return nodes.map((node) => {
                        if (node.path === path && node.isDir) {
                            return { ...node, isExpanded: !node.isExpanded };
                        }
                        if (node.children) {
                            return { ...node, children: toggleNode(node.children) };
                        }
                        return node;
                    });
                };
                set({ fileTree: toggleNode(get().fileTree) });
            },

            openFile: (file) => {
                const { openFiles } = get();
                const normalizedPath = normalizePath(file.path);
                const exists = openFiles.find((f) => pathsEqual(f.path, normalizedPath));

                if (!exists) {
                    set({
                        openFiles: [...openFiles, { ...file, path: normalizedPath }],
                        currentFilePath: normalizedPath,
                    });
                } else {
                    set({
                        openFiles: openFiles.map((existingFile) =>
                            pathsEqual(existingFile.path, normalizedPath)
                                ? { ...existingFile, ...file, path: existingFile.path }
                                : existingFile
                        ),
                        currentFilePath: exists.path,
                    });
                }
                get().saveSession();
            },

            closeFile: (path) => {
                const { openFiles, currentFilePath } = get();
                const newOpenFiles = openFiles.filter((f) => !pathsEqual(f.path, path));

                let newCurrentPath = currentFilePath;
                if (pathsEqual(currentFilePath, path)) {
                    const idx = openFiles.findIndex((f) => pathsEqual(f.path, path));
                    newCurrentPath = newOpenFiles[Math.max(0, idx - 1)]?.path ?? null;
                }

                set({
                    openFiles: newOpenFiles,
                    currentFilePath: newCurrentPath,
                });
                get().saveSession();
            },

            setCurrentFile: (path) => {
                const existingPath =
                    get().openFiles.find((file) => pathsEqual(file.path, path))?.path || normalizePath(path);
                set({ currentFilePath: existingPath });
                get().saveSession();
            },

            updateFileContent: (path, content) => {
                set({
                    openFiles: get().openFiles.map((f) =>
                        pathsEqual(f.path, path) ? { ...f, content, isDirty: true } : f
                    ),
                });
            },

            replaceFileContent: (path, content, isDirty = false) => {
                set({
                    openFiles: get().openFiles.map((f) =>
                        pathsEqual(f.path, path) ? { ...f, content, isDirty } : f
                    ),
                });
            },

            markFileSaved: (path) => {
                set({
                    openFiles: get().openFiles.map((f) =>
                        pathsEqual(f.path, path) ? { ...f, isDirty: false } : f
                    ),
                });
            },

            // Multi-select actions
            setSelectedPaths: (paths) => set({
                selectedPaths: paths,
                lastSelectedPath: paths.length > 0 ? paths[paths.length - 1] : null
            }),

            toggleSelection: (path) => {
                const { selectedPaths } = get();
                const isSelected = selectedPaths.includes(path);
                if (isSelected) {
                    set({
                        selectedPaths: selectedPaths.filter(p => p !== path),
                    });
                } else {
                    set({
                        selectedPaths: [...selectedPaths, path],
                        lastSelectedPath: path,
                    });
                }
            },

            selectRange: (endPath) => {
                const { lastSelectedPath, fileTree } = get();
                if (!lastSelectedPath) {
                    set({ selectedPaths: [endPath], lastSelectedPath: endPath });
                    return;
                }

                const flat = flattenTree(fileTree);
                const startIdx = flat.indexOf(lastSelectedPath);
                const endIdx = flat.indexOf(endPath);

                if (startIdx === -1 || endIdx === -1) {
                    set({ selectedPaths: [endPath], lastSelectedPath: endPath });
                    return;
                }

                const [from, to] = startIdx < endIdx ? [startIdx, endIdx] : [endIdx, startIdx];
                const range = flat.slice(from, to + 1);
                set({ selectedPaths: range, lastSelectedPath: endPath });
            },

            clearSelection: () => set({ selectedPaths: [], lastSelectedPath: null }),
            setDraggedPaths: (paths) => set({ draggedPaths: paths }),
            clearDraggedPaths: () => set({ draggedPaths: [] }),
        }),
        {
            name: "voidesk-file-session",
            partialize: (state) => ({
                rootPath: state.rootPath,
                recentProjects: state.recentProjects,
                sessionOpenFiles: state.sessionOpenFiles,
                sessionCurrentFilePath: state.sessionCurrentFilePath,
            }),
        }
    )
);
