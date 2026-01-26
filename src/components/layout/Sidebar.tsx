import { useState } from "react";
import { FileTree } from "@/components/file-tree/FileTree";
import { useFileStore, FileNode } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import {
    FolderOpen,
    FolderPlus,
    FilePlus,
    Search,
    Settings,
    RefreshCw,
} from "lucide-react";

export function Sidebar() {
    const { fileTree, rootPath, draggedPaths, clearDraggedPaths } = useFileStore();
    const {
        openFolder,
        refreshFileTree,
        createNewFile,
        createNewFolder,
        moveItem,
        batchMoveFiles,
    } = useFileSystem();
    const [isLoading, setIsLoading] = useState(false);
    const [searchQuery, setSearchQuery] = useState("");
    const [isRootDragOver, setIsRootDragOver] = useState(false);

    const handleOpenFolder = async () => {
        setIsLoading(true);
        await openFolder();
        setIsLoading(false);
    };

    const handleRefresh = async () => {
        if (!rootPath) return;
        setIsLoading(true);
        await refreshFileTree(rootPath);
        setIsLoading(false);
    };

    const handleNewFile = async () => {
        if (!rootPath) return;
        const name = prompt("Enter file name:");
        if (name) {
            await createNewFile(rootPath, name);
            await refreshFileTree(rootPath);
        }
    };

    const handleNewFolder = async () => {
        if (!rootPath) return;
        const name = prompt("Enter folder name:");
        if (name) {
            await createNewFolder(rootPath, name);
            await refreshFileTree(rootPath);
        }
    };

    // Filter file tree based on search
    const filteredTree = searchQuery
        ? filterTree(fileTree, searchQuery.toLowerCase())
        : fileTree;

    // Project is open when we have a root path
    const hasProject = !!rootPath;

    // Handler for dropping files to root
    const handleRootDragOver = (e: React.DragEvent) => {
        if (hasProject) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            setIsRootDragOver(true);
        }
    };

    const handleRootDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        // Only reset if leaving the actual container (not entering a child)
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX;
        const y = e.clientY;
        if (x < rect.left || x > rect.right || y < rect.top || y > rect.bottom) {
            setIsRootDragOver(false);
        }
    };

    const handleRootDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsRootDragOver(false);

        if (!rootPath) return;

        // Try store first, fallback to dataTransfer
        let sourcePaths = draggedPaths;
        if (sourcePaths.length === 0) {
            const jsonData = e.dataTransfer.getData("application/x-voiddesk-paths");
            if (jsonData) {
                try {
                    sourcePaths = JSON.parse(jsonData);
                } catch {
                    const plainPath = e.dataTransfer.getData("text/plain");
                    if (plainPath) sourcePaths = [plainPath];
                }
            } else {
                const plainPath = e.dataTransfer.getData("text/plain");
                if (plainPath) sourcePaths = [plainPath];
            }
        }

        if (sourcePaths.length === 0) {
            console.log("No source paths found for root drop");
            return;
        }

        console.log("Root drop detected. Sources:", sourcePaths);

        const separator = rootPath.includes("\\") ? "\\" : "/";
        const operations: { from: string; to: string }[] = [];

        for (const sourcePath of sourcePaths) {
            const parts = sourcePath.split(/[/\\]/);
            const fileName: string = parts.pop() || "";
            const targetPath: string = `${rootPath}${separator}${fileName}`;

            if (sourcePath === targetPath) continue;

            const lastSeparator = Math.max(sourcePath.lastIndexOf("\\"), sourcePath.lastIndexOf("/"));
            const sourceDir: string = lastSeparator >= 0 ? sourcePath.substring(0, lastSeparator) : "";
            if (sourceDir === rootPath) continue;

            operations.push({ from: sourcePath, to: targetPath });
        }

        if (operations.length === 0) {
            clearDraggedPaths();
            return;
        }

        if (operations.length === 1) {
            const success = await moveItem(operations[0].from, operations[0].to);
            if (!success) {
                console.error("Failed to move to root:", operations[0].from);
            }
            clearDraggedPaths();
            return;
        }

        const results = await batchMoveFiles(operations);
        if (results.some((result) => !result.success)) {
            console.error("Failed to move some items to root", results);
        }
        clearDraggedPaths();
    };

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="panel-header">
                <span className="flex items-center gap-2">
                    <FolderOpen className="w-3.5 h-3.5" />
                    Explorer
                </span>
                <div className="flex items-center gap-1">
                    {hasProject && (
                        <>
                            <button
                                onClick={handleNewFile}
                                className="icon-btn"
                                title="New File"
                            >
                                <FilePlus className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={handleNewFolder}
                                className="icon-btn"
                                title="New Folder"
                            >
                                <FolderPlus className="w-3.5 h-3.5" />
                            </button>
                            <button
                                onClick={handleRefresh}
                                className="icon-btn"
                                title="Refresh"
                                disabled={isLoading}
                            >
                                <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Search - only show when project is open */}
            {hasProject && (
                <div className="p-2">
                    <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--color-void-800)] rounded-md border border-[var(--color-border-subtle)] focus-within:border-[var(--color-accent-primary)]">
                        <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)]" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search files..."
                            className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none"
                        />
                    </div>
                </div>
            )}

            {/* File Tree or Empty State - empty space acts as root drop zone */}
            <div 
                className={`flex-1 overflow-auto px-2 pb-2 ${isRootDragOver ? "bg-[rgb(99_102_241_/_0.05)]" : ""}`}
                onDragOver={handleRootDragOver}
                onDragLeave={handleRootDragLeave}
                onDrop={handleRootDrop}
            >
                {hasProject ? (
                    <FileTree nodes={filteredTree} depth={0} rootPath={rootPath} />
                ) : (
                    <div className="flex flex-col items-center justify-center h-full text-center px-4">
                        <FolderOpen className="w-10 h-10 opacity-20 text-[var(--color-text-tertiary)] mb-3" />
                        <p className="text-sm text-[var(--color-text-tertiary)] mb-2">
                            No folder open
                        </p>
                        <button
                            onClick={handleOpenFolder}
                            className="px-3 py-1.5 text-xs bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] rounded-md hover:opacity-90 transition-opacity"
                        >
                            Open Folder
                        </button>
                        <p className="text-xs text-[var(--color-text-muted)] mt-2">
                            or press Ctrl+O
                        </p>
                    </div>
                )}
            </div>

            {/* Footer - only show when project is open */}
            {hasProject && (
                <div className="flex items-center justify-between p-2 border-t border-[var(--color-border-subtle)] shrink-0">
                    <span className="text-xs text-[var(--color-text-muted)] truncate max-w-[80%]" title={rootPath}>
                        {rootPath.split(/[/\\]/).pop()}
                    </span>
                    <button
                        onClick={handleOpenFolder}
                        className="icon-btn"
                        title="Open Different Folder"
                    >
                        <Settings className="w-4 h-4" />
                    </button>
                </div>
            )}
        </div>
    );
}

// Helper to filter tree by search query
function filterTree(nodes: FileNode[], query: string): FileNode[] {
    const result: FileNode[] = [];

    for (const node of nodes) {
        if (node.name.toLowerCase().includes(query)) {
            result.push(node);
        } else if (node.isDir && node.children) {
            const filteredChildren = filterTree(node.children, query);
            if (filteredChildren.length > 0) {
                result.push({ ...node, children: filteredChildren, isExpanded: true });
            }
        }
    }

    return result;
}
