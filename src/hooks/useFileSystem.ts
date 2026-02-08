import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import { FileNode, useFileStore } from "@/stores/fileStore";

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
        path: node.path,
        name: node.name,
        isDir: node.is_dir,
        isExpanded: false,
        children: node.children?.map(convertToFileNode),
    };
}

export function useFileSystem() {
    const { setRootPath, setFileTree, openFile, rootPath } = useFileStore();

    // Open folder picker dialog
    const openFolder = async (): Promise<string | null> => {
        try {
            const selected = await open({
                directory: true,
                multiple: false,
                title: "Open Folder",
            });

            if (selected && typeof selected === "string") {
                setRootPath(selected);
                await refreshFileTree(selected);
                useFileStore.getState().addRecentProject(selected);
                return selected;
            }
            return null;
        } catch (error) {
            console.error("Failed to open folder:", error);
            return null;
        }
    };

    const openFolderAt = async (path: string): Promise<boolean> => {
        try {
            setRootPath(path);
            await refreshFileTree(path);
            useFileStore.getState().addRecentProject(path);
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
                path,
                maxDepth: 5,
            });

            const fileNodes = tree.map(convertToFileNode);
            setFileTree(fileNodes);
        } catch (error) {
            console.error("Failed to get project tree:", error);
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
            return await invoke<string>("read_file", { path });
        } catch (error) {
            console.error("Failed to read file:", error);
            return null;
        }
    };

    // Write file contents
    const writeFile = async (path: string, content: string): Promise<boolean> => {
        try {
            await invoke("write_file", { path, content });
            // Auto-refresh to show newly created files
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
            return true;
        } catch (error) {
            console.error("Failed to write file:", error);
            return false;
        }
    };

    // Delete file or directory
    const deleteFile = async (path: string): Promise<boolean> => {
        try {
            await invoke("delete_file", { path });
            // Auto-refresh to remove deleted files from view
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
            return true;
        } catch (error) {
            console.error("Failed to delete file:", error);
            return false;
        }
    };

    // Reveal file or folder in system file explorer
    const revealInExplorer = async (path: string): Promise<boolean> => {
        try {
            await invoke("reveal_in_file_explorer", { path });
            return true;
        } catch (error) {
            console.error("Failed to reveal in explorer:", error);
            return false;
        }
    };

    // Open a file in the editor
    const openFileInEditor = async (path: string, name: string): Promise<void> => {
        const content = await readFile(path);
        if (content !== null) {
            openFile({
                path,
                name,
                content,
                isDirty: false,
                language: getLanguageFromFilename(name),
            });
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
        const filePath = `${parentPath}/${fileName}`;
        return await writeFile(filePath, "");
    };

    // Create a new folder
    const createNewFolder = async (parentPath: string, folderName: string): Promise<boolean> => {
        try {
            await invoke("create_directory", { path: `${parentPath}/${folderName}` });
            // Auto-refresh to show newly created folder
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
            return true;
        } catch (error) {
            console.error("Failed to create folder:", error);
            return false;
        }
    };

    const moveItem = async (fromPath: string, toPath: string): Promise<boolean> => {
        try {
            await invoke("move_file", { from: fromPath, to: toPath });
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
            return true;
        } catch (error) {
            console.error("Failed to move item:", error);
            return false;
        }
    };

    const renameFile = async (oldPath: string, newPath: string): Promise<boolean> => {
        try {
            await invoke("rename_file", { oldPath, newPath });
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
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
            const results = await invoke<BatchOperationResult[]>("batch_delete_files", { paths });
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
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
            const results = await invoke<BatchOperationResult[]>("batch_move_files", { operations });
            if (rootPath) {
                await refreshFileTree(rootPath);
            }
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
