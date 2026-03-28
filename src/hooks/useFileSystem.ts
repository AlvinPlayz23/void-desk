import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { useShallow } from "zustand/react/shallow";
import { FileNode, useFileStore } from "@/stores/fileStore";
import { useEditorStore } from "@/stores/editorStore";
import { normalizePath, pathsEqual } from "@/utils/path";

interface FileEntry {
    path: string;
    name: string;
    is_dir: boolean;
}

interface TauriFileNode {
    path: string;
    name: string;
    is_dir: boolean;
    children?: TauriFileNode[];
}

// Convert Tauri response to our FileNode format
function convertToFileNode(node: TauriFileNode): FileNode {
    return {
        path: normalizePath(node.path),
        name: node.name,
        isDir: node.is_dir,
        isExpanded: false,
        children: node.children?.map(convertToFileNode),
    };
}

export function useFileSystem() {
    const { setRootPath, setFileTree, openFile, replaceFileContent, rootPath } = useFileStore(
        useShallow((state) => ({
            setRootPath: state.setRootPath,
            setFileTree: state.setFileTree,
            openFile: state.openFile,
            replaceFileContent: state.replaceFileContent,
            rootPath: state.rootPath,
        }))
    );

    // Open folder picker dialog
    const openFolder = async (): Promise<string | null> => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Open Folder",
            });

            if (selected && typeof selected === "string") {
                const normalizedSelected = normalizePath(selected);
                setRootPath(normalizedSelected);
                await refreshFileTree(normalizedSelected);
                useFileStore.getState().addRecentProject(normalizedSelected);
                return normalizedSelected;
            }
            return null;
        } catch (error) {
            console.error("Failed to open folder:", error);
            return null;
        }
    };

    const openFolderAt = async (path: string): Promise<boolean> => {
        try {
            const normalizedPath = normalizePath(path);
            setRootPath(normalizedPath);
            await refreshFileTree(normalizedPath);
            useFileStore.getState().addRecentProject(normalizedPath);
            return true;
        } catch (error) {
            console.error("Failed to open folder:", error);
            return false;
        }
    };

    // Refresh file tree from disk
    const refreshFileTree = async (path: string): Promise<void> => {
        try {
            const tree = await invoke<TauriFileNode[]>("get_project_tree", {
                path: normalizePath(path),
                maxDepth: 5,
            });

            if (!pathsEqual(useFileStore.getState().rootPath, path)) {
                return;
            }

            const fileNodes = tree.map(convertToFileNode);
            setFileTree(fileNodes);
        } catch (error) {
            console.error("Failed to get project tree:", error);
        }
    };

    const refreshCurrentFileTree = async (): Promise<void> => {
        const currentRootPath = useFileStore.getState().rootPath;
        if (currentRootPath) {
            await refreshFileTree(currentRootPath);
        }
    };

    // List directory contents
    const listDirectory = async (path: string): Promise<FileEntry[]> => {
        try {
            return await invoke<FileEntry[]>("list_directory", { path });
        } catch (error) {
            console.error("Failed to list directory:", error);
            return [];
        }
    };

    // Read file contents
    const readFile = async (path: string): Promise<string | null> => {
        try {
            return await invoke<string>("read_file", { path: normalizePath(path) });
        } catch (error) {
            console.error("Failed to read file:", error);
            return null;
        }
    };

    // Write file contents
    const writeFile = async (path: string, content: string): Promise<boolean> => {
        try {
            await invoke("write_file", { path: normalizePath(path), content });
            await refreshCurrentFileTree();
            return true;
        } catch (error) {
            console.error("Failed to write file:", error);
            return false;
        }
    };

    // Delete file or directory
    const deleteFile = async (path: string): Promise<boolean> => {
        try {
            await invoke("delete_file", { path: normalizePath(path) });
            await refreshCurrentFileTree();
            return true;
        } catch (error) {
            console.error("Failed to delete file:", error);
            return false;
        }
    };

    // Reveal file or folder in system file explorer
    const revealInExplorer = async (path: string): Promise<boolean> => {
        try {
            await invoke("reveal_in_file_explorer", { path: normalizePath(path) });
            return true;
        } catch (error) {
            console.error("Failed to reveal in explorer:", error);
            return false;
        }
    };

    // Open a file in the editor
    const openFileInEditor = async (path: string, name: string): Promise<void> => {
        const normalizedPath = normalizePath(path);
        const existingFile = useFileStore
            .getState()
            .openFiles.find((file) => pathsEqual(file.path, normalizedPath));
        const resolvedPath = existingFile?.path || normalizedPath;
        const content = await readFile(resolvedPath);
        if (content !== null) {
            openFile({
                path: resolvedPath,
                name,
                content,
                isDirty: false,
                language: getLanguageFromFilename(name),
            });
        }
    };

    const openFileAtLocation = async (
        path: string,
        name: string,
        line: number,
        column: number,
        endLine?: number,
        endColumn?: number
    ): Promise<void> => {
        const normalizedPath = normalizePath(path);
        const existingFile = useFileStore
            .getState()
            .openFiles.find((file) => pathsEqual(file.path, normalizedPath));
        const resolvedPath = existingFile?.path || normalizedPath;
        await openFileInEditor(resolvedPath, name);
        useEditorStore.getState().navigateTo({
            path: resolvedPath,
            line,
            column,
            endLine,
            endColumn,
        });
    };

    const reloadOpenFile = async (path: string): Promise<void> => {
        const resolvedPath =
            useFileStore.getState().openFiles.find((file) => pathsEqual(file.path, path))?.path ||
            normalizePath(path);
        const content = await readFile(resolvedPath);
        if (content !== null) {
            replaceFileContent(resolvedPath, content, false);
        }
    };

    // Save current file
    const saveFile = async (path: string, content: string): Promise<boolean> => {
        const success = await writeFile(path, content);
        if (success) {
            useFileStore.getState().markFileSaved(path);
        }
        return success;
    };

    // Create a new file
    const createNewFile = async (parentPath: string, fileName: string): Promise<boolean> => {
        const filePath = normalizePath(`${parentPath}/${fileName}`);
        return await writeFile(filePath, "");
    };

    // Create a new folder
    const createNewFolder = async (parentPath: string, folderName: string): Promise<boolean> => {
        try {
            await invoke("create_directory", { path: normalizePath(`${parentPath}/${folderName}`) });
            await refreshCurrentFileTree();
            return true;
        } catch (error) {
            console.error("Failed to create folder:", error);
            return false;
        }
    };

    const moveItem = async (fromPath: string, toPath: string): Promise<boolean> => {
        try {
            await invoke("move_file", { from: normalizePath(fromPath), to: normalizePath(toPath) });
            await refreshCurrentFileTree();
            return true;
        } catch (error) {
            console.error("Failed to move item:", error);
            return false;
        }
    };

    const renameFile = async (oldPath: string, newPath: string): Promise<boolean> => {
        try {
            await invoke("rename_file", { oldPath: normalizePath(oldPath), newPath: normalizePath(newPath) });
            await refreshCurrentFileTree();
            return true;
        } catch (error) {
            console.error("Failed to rename file:", error);
            return false;
        }
    };

    interface BatchOperationResult {
        path: string;
        success: boolean;
        error?: string;
    }

    const batchDeleteFiles = async (paths: string[]): Promise<BatchOperationResult[]> => {
        try {
            const results = await invoke<BatchOperationResult[]>("batch_delete_files", {
                paths: paths.map(normalizePath),
            });
            await refreshCurrentFileTree();
            return results;
        } catch (error) {
            console.error("Failed to batch delete files:", error);
            return paths.map(path => ({
                path,
                success: false,
                error: String(error)
            }));
        }
    };

    interface BatchMoveOperation {
        from: string;
        to: string;
    }

    const batchMoveFiles = async (operations: BatchMoveOperation[]): Promise<BatchOperationResult[]> => {
        try {
            const results = await invoke<BatchOperationResult[]>("batch_move_files", {
                operations: operations.map((op) => ({
                    from: normalizePath(op.from),
                    to: normalizePath(op.to),
                })),
            });
            await refreshCurrentFileTree();
            return results;
        } catch (error) {
            console.error("Failed to batch move files:", error);
            return operations.map(op => ({
                path: op.from,
                success: false,
                error: String(error)
            }));
        }
    };

    return {
        rootPath,
        openFolder,
        openFolderAt,
        refreshFileTree,
        listDirectory,
        readFile,
        writeFile,
        deleteFile,
        moveItem,
        renameFile,
        batchDeleteFiles,
        batchMoveFiles,
        revealInExplorer,
        openFileInEditor,
        openFileAtLocation,
        reloadOpenFile,
        saveFile,
        createNewFile,
        createNewFolder,
    };
}

function getLanguageFromFilename(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
        // JavaScript/TypeScript
        ts: "TypeScript",
        tsx: "TypeScript (TSX)",
        js: "JavaScript",
        jsx: "JavaScript (JSX)",
        mjs: "JavaScript (ESM)",
        cjs: "JavaScript (CJS)",
        // Python
        py: "Python",
        pyw: "Python",
        pyi: "Python (Stub)",
        // Rust
        rs: "Rust",
        // Web
        html: "HTML",
        htm: "HTML",
        xhtml: "XHTML",
        css: "CSS",
        scss: "SCSS",
        sass: "Sass",
        less: "Less",
        // Data formats
        json: "JSON",
        jsonc: "JSON with Comments",
        // Documentation
        md: "Markdown",
        markdown: "Markdown",
        mdx: "MDX",
        // Config
        toml: "TOML",
        yaml: "YAML",
        yml: "YAML",
        // Other languages
        go: "Go",
        java: "Java",
        c: "C",
        cpp: "C++",
        txt: "Plain Text",
    };
    return languageMap[ext || ""] || "Plain Text";
}
