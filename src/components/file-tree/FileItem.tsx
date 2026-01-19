import { FileNode, useFileStore } from "@/stores/fileStore";
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
} from "lucide-react";

interface FileItemProps {
    node: FileNode;
    depth: number;
    onClick: () => void;
}

export function FileItem({ node, depth, onClick }: FileItemProps) {
    const { currentFilePath } = useFileStore();
    const isSelected = currentFilePath === node.path;

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
        <div
            onClick={onClick}
            className={`file-item relative ${isSelected ? "selected" : ""}`}
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
    );
}
