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

interface FileState {
    // Project structure
    rootPath: string | null;
    fileTree: FileNode[];

    // Open files
    openFiles: OpenFile[];
    currentFilePath: string | null;

    // Actions
    setRootPath: (path: string) => void;
    setFileTree: (tree: FileNode[]) => void;
    toggleFolder: (path: string) => void;

    openFile: (file: OpenFile) => void;
    closeFile: (path: string) => void;
    setCurrentFile: (path: string) => void;
    updateFileContent: (path: string, content: string) => void;
    markFileSaved: (path: string) => void;
}

export const useFileStore = create<FileState>((set, get) => ({
    rootPath: null,
    fileTree: [],
    openFiles: [],
    currentFilePath: null,

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
}));
