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
    Edit2,
} from "lucide-react";

interface FileItemProps {
    node: FileNode;
    depth: number;
    onClick: () => void;
}

export function FileItem({ node, depth, onClick }: FileItemProps) {
    const {
        currentFilePath,
        selectedPaths,
        setSelectedPaths,
        toggleSelection,
        selectRange,
        lastSelectedPath,
    } = useFileStore();
    const { revealInExplorer, deleteFile, moveItem, renameFile, batchDeleteFiles, batchMoveFiles, refreshFileTree, rootPath } = useFileSystem();
    const isSelected = currentFilePath === node.path;
    const isMultiSelected = selectedPaths.includes(node.path);
    const [isDragOver, setIsDragOver] = useState(false);

    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        node: FileNode;
    } | null>(null);
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState("");
    const menuRef = useRef<HTMLDivElement>(null);
    const renameInputRef = useRef<HTMLInputElement>(null);

    const handleDragStart = (e: React.DragEvent) => {
        e.stopPropagation();
        console.log("Drag start:", node.path);
        const sourcePaths = selectedPaths.includes(node.path) ? selectedPaths : [node.path];
        e.dataTransfer.setData("text/plain", JSON.stringify(sourcePaths));
        e.dataTransfer.effectAllowed = "move";

        // Add a custom drag image effect by setting opacity via CSS class
        const target = e.currentTarget as HTMLElement;
        target.classList.add("dragging");

        // Remove the class after drag ends
        setTimeout(() => {
            target.classList.remove("dragging");
        }, 0);
    };

    const handleDragEnd = (e: React.DragEvent) => {
        e.stopPropagation();
        const target = e.currentTarget as HTMLElement;
        target.classList.remove("dragging");
    };

    const handleDragEnter = (e: React.DragEvent) => {
        if (node.isDir) {
            e.preventDefault();
            e.stopPropagation();

            // Get the source path to check if we're dragging into ourselves
            const raw = e.dataTransfer.types.includes("text/plain")
                ? e.dataTransfer.getData("text/plain")
                : null;
            let sourcePath: string | null = null;
            if (raw) {
                try {
                    const parsed = JSON.parse(raw);
                    sourcePath = Array.isArray(parsed) ? parsed[0] : raw;
                } catch {
                    sourcePath = raw;
                }
            }

            // Only show drop indicator if this is a valid target
            if (!sourcePath || (sourcePath !== node.path && !node.path.startsWith(sourcePath + "\\"))) {
                setIsDragOver(true);
            }
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        if (node.isDir) {
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = "move";
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        // Use relatedTarget to check if we're leaving to a child element
        const relatedTarget = e.relatedTarget as HTMLElement | null;
        const currentTarget = e.currentTarget as HTMLElement;

        // Only remove highlight if we're actually leaving this element (not entering a child)
        if (!relatedTarget || !currentTarget.contains(relatedTarget)) {
            setIsDragOver(false);
        }
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);

        if (!node.isDir) return;

        const raw = e.dataTransfer.getData("text/plain");
        if (!raw) return;

        let sourcePaths: string[] = [];
        try {
            const parsed = JSON.parse(raw);
            sourcePaths = Array.isArray(parsed) ? parsed : [raw];
        } catch {
            sourcePaths = [raw];
        }

        console.log("Move detected. Target Dir:", node.path, "Sources:", sourcePaths);

        const operations: { from: string; to: string }[] = [];
        const separator = node.path.includes('\\') ? '\\' : '/';

        for (const src of sourcePaths) {
            if (src === node.path) continue; // Can't move onto itself
            if (node.path.startsWith(src + "\\") || node.path.startsWith(src + "/")) {
                console.warn(`Cannot move ${src} into its own subdirectory`);
                continue;
            }

            const parts = src.split(/[/\\]/);
            const fileName = parts.pop() || "";
            const targetPath = `${node.path}${separator}${fileName}`;

            // Check if already in this folder
            const sourceDir = src.substring(0, src.lastIndexOf(separator));
            if (sourceDir !== node.path) {
                operations.push({ from: src, to: targetPath });
            }
        }

        if (operations.length === 0) return;

        console.log("Moving items...", operations);
        if (operations.length === 1) {
            await moveItem(operations[0].from, operations[0].to);
        } else {
            await batchMoveFiles(operations);
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
        if (!selectedPaths.includes(node.path)) {
            setSelectedPaths([node.path]);
        }
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
            const isTargetInSelection = selectedPaths.includes(contextMenu.node.path);
            const targets = isTargetInSelection ? selectedPaths : [contextMenu.node.path];

            const message = targets.length > 1
                ? `Are you sure you want to delete ${targets.length} selected items?`
                : `Are you sure you want to delete "${contextMenu.node.name}"?`;

            const confirmed = window.confirm(message);
            if (confirmed) {
                if (targets.length > 1) {
                    await batchDeleteFiles(targets);
                } else {
                    await deleteFile(targets[0]);
                }

                if (rootPath) {
                    await refreshFileTree(rootPath);
                }
            }
            setContextMenu(null);
        }
    };

    const handleRenameClick = () => {
        if (contextMenu) {
            setRenameValue(contextMenu.node.name);
            setIsRenaming(true);
            setContextMenu(null);
        }
    };

    const handleRenameSubmit = async () => {
        if (!renameValue.trim() || renameValue === node.name) {
            setIsRenaming(false);
            return;
        }

        try {
            const oldPath = node.path;
            const separator = oldPath.includes("\\") ? "\\" : "/";
            const parentPath = oldPath.substring(0, oldPath.lastIndexOf(separator));
            const newPath = `${parentPath}${separator}${renameValue}`;

            await renameFile(oldPath, newPath);

            if (rootPath) {
                await refreshFileTree(rootPath);
            }
        } catch (error) {
            console.error("Failed to rename file:", error);
            alert(`Failed to rename: ${error}`);
        }

        setIsRenaming(false);
    };

    const handleRenameKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            handleRenameSubmit();
        } else if (e.key === "Escape") {
            setIsRenaming(false);
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
                onDragEnd={handleDragEnd}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                onClick={(e) => {
                    if (e.shiftKey && lastSelectedPath) {
                        selectRange(node.path);
                        return;
                    }

                    if (e.ctrlKey || e.metaKey) {
                        toggleSelection(node.path);
                        return;
                    }

                    setSelectedPaths([node.path]);
                    onClick();
                }}
                onContextMenu={handleContextMenu}
                className={`file-item relative ${isSelected ? "selected" : ""} ${isMultiSelected ? "multi-selected" : ""} ${isDragOver ? "drag-over" : ""}`}
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
                {isRenaming ? (
                    <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={handleRenameSubmit}
                        onKeyDown={handleRenameKeyDown}
                        autoFocus
                        className="flex-1 px-2 py-0.5 bg-[var(--color-void-700)] text-[var(--color-text-primary)] border border-[var(--color-accent-primary)] rounded text-sm outline-none"
                        onClick={(e) => e.stopPropagation()}
                    />
                ) : (
                    <span className="truncate">{node.name}</span>
                )}
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
                    <button
                        onClick={handleRenameClick}
                        className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)]"
                    >
                        <Edit2 className="w-3.5 h-3.5" />
                        Rename
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
