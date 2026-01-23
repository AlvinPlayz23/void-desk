import { useState, useRef, useEffect } from "react";
import { FileNode, useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";
import {
    ChevronRight,
    ChevronDown,
    File,
    Folder,
    FolderOpen,
    FileCode,
    FileJson,
    FileText,
    FileType,
    Palette,
    Copy,
    ExternalLink,
    Trash2,
} from "lucide-react";

interface FileItemProps {
    node: FileNode;
    depth: number;
    onClick: () => void;
}

export function FileItem({ node, depth, onClick }: FileItemProps) {
    const { currentFilePath } = useFileStore();
    const { revealInExplorer, deleteFile, moveItem, refreshFileTree, rootPath } = useFileSystem();
    const isSelected = currentFilePath === node.path;
    const [isDragOver, setIsDragOver] = useState(false);

    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        node: FileNode;
    } | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);

    const handleDragStart = (e: React.DragEvent) => {
        console.log("Drag start:", node.path);
        e.dataTransfer.setData("text/plain", node.path);
        e.dataTransfer.effectAllowed = "move";
        // Ensure the ghost image is visible
        e.dataTransfer.setDragImage(e.currentTarget, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (node.isDir) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
            if (!isDragOver) setIsDragOver(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Only remove highlight if we're actually leaving the item (not entering a child)
        if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        if (node.isDir) {
            e.preventDefault();
            e.stopPropagation();
            setIsDragOver(false);

            const sourcePath = e.dataTransfer.getData("text/plain");
            console.log("Drop detected. Source:", sourcePath, "Target Dir:", node.path);

            if (sourcePath && sourcePath !== node.path) {
                // Ensure we handle both / and \ for Windows compatibility
                const parts = sourcePath.split(/[/\\]/);
                const fileName = parts.pop() || "";

                // Use the correct separator based on the existing path
                const separator = node.path.includes('\\') ? '\\' : '/';
                const targetPath = `${node.path}${separator}${fileName}`;

                console.log("Moving to:", targetPath);
                const success = await moveItem(sourcePath, targetPath);
                if (!success) {
                    console.error("Move failed from", sourcePath, "to", targetPath);
                }
            }
        }
    };

    // Close context menu when clicking outside
    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                setContextMenu(null);
            }
        };
        document.addEventListener("click", handleClick);
        return () => document.removeEventListener("click", handleClick);
    }, []);

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            node,
        });
    };

    const handleCopyPath = async () => {
        if (contextMenu) {
            await navigator.clipboard.writeText(contextMenu.node.path);
            setContextMenu(null);
        }
    };

    const handleRevealInExplorer = async () => {
        if (contextMenu) {
            await revealInExplorer(contextMenu.node.path);
            setContextMenu(null);
        }
    };

    const handleDelete = async () => {
        if (contextMenu) {
            const confirmed = window.confirm(
                `Are you sure you want to delete "${contextMenu.node.name}"?`
            );
            if (confirmed) {
                await deleteFile(contextMenu.node.path);
                if (rootPath) {
                    await refreshFileTree(rootPath);
                }
            }
            setContextMenu(null);
        }
    };

    const getFileIcon = () => {
        if (node.isDir) {
            return node.isExpanded ? (
                <FolderOpen className="w-4 h-4 text-[#e8a854]" />
            ) : (
                <Folder className="w-4 h-4 text-[#e8a854]" />
            );
        }

        const ext = node.name.split(".").pop()?.toLowerCase();

        switch (ext) {
            case "ts":
            case "tsx":
                return <FileCode className="w-4 h-4 text-[#3178c6]" />;
            case "js":
            case "jsx":
                return <FileCode className="w-4 h-4 text-[#f7df1e]" />;
            case "json":
                return <FileJson className="w-4 h-4 text-[#cbcb41]" />;
            case "css":
            case "scss":
            case "sass":
                return <Palette className="w-4 h-4 text-[#42a5f5]" />;
            case "md":
                return <FileText className="w-4 h-4 text-[#519aba]" />;
            case "html":
                return <FileType className="w-4 h-4 text-[#e34c26]" />;
            case "py":
                return <FileCode className="w-4 h-4 text-[#3572A5]" />;
            case "rs":
                return <FileCode className="w-4 h-4 text-[#dea584]" />;
            default:
                return <File className="w-4 h-4 text-[var(--color-text-tertiary)]" />;
        }
    };

    return (
        <>
            <div
                draggable
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={onClick}
                onContextMenu={handleContextMenu}
                className={`file-item relative ${isSelected ? "selected" : ""} ${isDragOver ? "drag-over" : ""}`}
                style={{ paddingLeft: `${depth * 12 + 4}px` }}
            >
                {/* Expand/Collapse Arrow */}
                {node.isDir && (
                    <span className="flex-shrink-0 w-4 h-4 flex items-center justify-center">
                        {node.isExpanded ? (
                            <ChevronDown className="w-3 h-3" />
                        ) : (
                            <ChevronRight className="w-3 h-3" />
                        )}
                    </span>
                )}

                {/* File/Folder Icon */}
                <span className="flex-shrink-0">{getFileIcon()}</span>

                {/* Name */}
                <span className="truncate">{node.name}</span>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    ref={menuRef}
                    className="fixed z-50 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg shadow-xl py-1 min-w-[180px]"
                    style={{
                        left: contextMenu.x,
                        top: contextMenu.y,
                    }}
                >
                    <button
                        onClick={handleCopyPath}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)]"
                    >
                        <Copy className="w-3.5 h-3.5" />
                        Copy Path
                    </button>
                    <button
                        onClick={handleRevealInExplorer}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)]"
                    >
                        <ExternalLink className="w-3.5 h-3.5" />
                        Reveal in Explorer
                    </button>
                    <div className="border-t border-[var(--color-border-subtle)] my-1" />
                    <button
                        onClick={handleDelete}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-red-400 hover:bg-[var(--color-void-700)]"
                    >
                        <Trash2 className="w-3.5 h-3.5" />
                        Delete
                    </button>
                </div>
            )}
        </>
    );
}
