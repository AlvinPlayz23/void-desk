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
    const { fileTree, rootPath } = useFileStore();
    const { openFolder, refreshFileTree, createNewFile, createNewFolder, moveItem } = useFileSystem();
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

        const sourcePath = e.dataTransfer.getData("text/plain");
        if (!sourcePath) return;

        // Extract file name from source path
        const parts = sourcePath.split(/[/\\]/);
        const fileName = parts.pop() || "";

        // Determine separator based on rootPath
        const separator = rootPath.includes('\\') ? '\\' : '/';
        const targetPath = `${rootPath}${separator}${fileName}`;

        // Don't move if already at root or same path
        if (sourcePath === targetPath) return;

        // Don't move if source is a direct child of root (already at root level)
        const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf(separator));
        if (sourceDir === rootPath) return;

        console.log("Moving to root:", sourcePath, "->", targetPath);
        const success = await moveItem(sourcePath, targetPath);
        if (!success) {
            console.error("Failed to move to root:", sourcePath);
        }
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

            {/* File Tree or Empty State - with root drop zone */}
            <div
                className={`flex-1 overflow-auto px-2 pb-2 ${isRootDragOver ? "root-drop-zone-active" : ""}`}
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
                <div className="flex items-center justify-between p-2 border-t border-[var(--color-border-subtle)]">
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
