import { create } from "zustand";

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

    // Actions
    setRootPath: (path: string) => void;
    setFileTree: (tree: FileNode[]) => void;
    toggleFolder: (path: string) => void;

    openFile: (file: OpenFile) => void;
    closeFile: (path: string) => void;
    setCurrentFile: (path: string) => void;
    updateFileContent: (path: string, content: string) => void;
    markFileSaved: (path: string) => void;

    // Multi-select actions
    setSelectedPaths: (paths: string[]) => void;
    toggleSelection: (path: string) => void;
    selectRange: (endPath: string) => void;
    clearSelection: () => void;
}

export const useFileStore = create<FileState>((set, get) => ({
    rootPath: null,
    fileTree: [],
    openFiles: [],
    currentFilePath: null,
    selectedPaths: [],
    lastSelectedPath: null,

    setRootPath: (path) => set({ rootPath: path }),

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
        const exists = openFiles.find((f) => f.path === file.path);

        if (!exists) {
            set({
                openFiles: [...openFiles, file],
                currentFilePath: file.path,
            });
        } else {
            set({ currentFilePath: file.path });
        }
    },

    closeFile: (path) => {
        const { openFiles, currentFilePath } = get();
        const newOpenFiles = openFiles.filter((f) => f.path !== path);

        let newCurrentPath = currentFilePath;
        if (currentFilePath === path) {
            const idx = openFiles.findIndex((f) => f.path === path);
            newCurrentPath = newOpenFiles[Math.max(0, idx - 1)]?.path ?? null;
        }

        set({
            openFiles: newOpenFiles,
            currentFilePath: newCurrentPath,
        });
    },

    setCurrentFile: (path) => set({ currentFilePath: path }),

    updateFileContent: (path, content) => {
        set({
            openFiles: get().openFiles.map((f) =>
                f.path === path ? { ...f, content, isDirty: true } : f
            ),
        });
    },

    markFileSaved: (path) => {
        set({
            openFiles: get().openFiles.map((f) =>
                f.path === path ? { ...f, isDirty: false } : f
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
}));
