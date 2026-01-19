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
    const { setRootPath, setFileTree, openFile } = useFileStore();

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
                return selected;
            }
            return null;
        } catch (error) {
            console.error("Failed to open folder:", error);
            return null;
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
            return true;
        } catch (error) {
            console.error("Failed to delete file:", error);
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
            return true;
        } catch (error) {
            console.error("Failed to create folder:", error);
            return false;
        }
    };

    return {
        openFolder,
        refreshFileTree,
        listDirectory,
        readFile,
        writeFile,
        deleteFile,
        openFileInEditor,
        saveFile,
        createNewFile,
        createNewFolder,
    };
}

function getLanguageFromFilename(filename: string): string {
    const ext = filename.split(".").pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
        ts: "TypeScript",
        tsx: "TypeScript React",
        js: "JavaScript",
        jsx: "JavaScript React",
        json: "JSON",
        css: "CSS",
        html: "HTML",
        md: "Markdown",
        py: "Python",
        rs: "Rust",
        go: "Go",
        java: "Java",
        c: "C",
        cpp: "C++",
    };
    return languageMap[ext || ""] || "Plain Text";
}
