import { useFileStore } from "@/stores/fileStore";
import { X, FileCode } from "lucide-react";

export function EditorTabs() {
    const { openFiles, currentFilePath, setCurrentFile, closeFile } = useFileStore();

    const getFileIcon = (filename: string) => {
        const ext = filename.split(".").pop()?.toLowerCase();

        const colorMap: Record<string, string> = {
            ts: "#3178c6",
            tsx: "#3178c6",
            js: "#f7df1e",
            jsx: "#f7df1e",
            json: "#cbcb41",
            css: "#42a5f5",
            md: "#519aba",
            html: "#e34c26",
            py: "#3572A5",
            rs: "#dea584",
        };

        return (
            <FileCode
                className="w-3.5 h-3.5"
                style={{ color: colorMap[ext || ""] || "var(--color-text-tertiary)" }}
            />
        );
    };

    return (
        <div className="flex items-center bg-[var(--color-surface-sunken)] border-b border-[var(--color-border-subtle)] overflow-x-auto">
            {openFiles.map((file) => (
                <div
                    key={file.path}
                    className={`tab group ${currentFilePath === file.path ? "active" : ""}`}
                    onClick={() => setCurrentFile(file.path)}
                >
                    {/* File Icon */}
                    {getFileIcon(file.name)}

                    {/* File Name */}
                    <span className="max-w-[120px] truncate">{file.name}</span>

                    {/* Dirty Indicator / Close Button */}
                    <span
                        className="tab-close"
                        onClick={(e) => {
                            e.stopPropagation();
                            closeFile(file.path);
                        }}
                    >
                        {file.isDirty ? (
                            <span className="w-2 h-2 rounded-full bg-[var(--color-accent-primary)]" />
                        ) : (
                            <X className="w-3 h-3" />
                        )}
                    </span>
                </div>
            ))}
        </div>
    );
}
