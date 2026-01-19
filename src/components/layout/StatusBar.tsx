import { useFileStore } from "@/stores/fileStore";
import { useEditorStore } from "@/stores/editorStore";
import {
    GitBranch,
    AlertCircle,
    AlertTriangle,
    Bell,
    Check,
} from "lucide-react";

export function StatusBar() {
    const { openFiles, currentFilePath } = useFileStore();
    const { cursorLine, cursorColumn } = useEditorStore();

    const currentFile = openFiles.find((f) => f.path === currentFilePath);

    return (
        <div className="status-bar">
            {/* Left Section */}
            <div className="flex items-center">
                {/* Git Branch */}
                <div className="status-item cursor-pointer hover:bg-[var(--color-void-800)]">
                    <GitBranch className="w-3 h-3" />
                    <span>main</span>
                </div>

                {/* Sync Status */}
                <div className="status-item">
                    <Check className="w-3 h-3 text-[var(--color-accent-success)]" />
                </div>

                {/* Errors & Warnings */}
                <div className="status-item cursor-pointer hover:bg-[var(--color-void-800)]">
                    <AlertCircle className="w-3 h-3" />
                    <span>0</span>
                    <AlertTriangle className="w-3 h-3 ml-1" />
                    <span>0</span>
                </div>
            </div>

            {/* Right Section */}
            <div className="flex items-center">
                {/* Cursor Position */}
                {currentFile && (
                    <div className="status-item cursor-pointer hover:bg-[var(--color-void-800)]">
                        <span>Ln {cursorLine}, Col {cursorColumn}</span>
                    </div>
                )}

                {/* Language */}
                {currentFile && (
                    <div className="status-item cursor-pointer hover:bg-[var(--color-void-800)]">
                        <span>{currentFile.language || "Plain Text"}</span>
                    </div>
                )}

                {/* Encoding */}
                <div className="status-item cursor-pointer hover:bg-[var(--color-void-800)]">
                    <span>UTF-8</span>
                </div>

                {/* Notifications */}
                <div className="status-item cursor-pointer hover:bg-[var(--color-void-800)]">
                    <Bell className="w-3 h-3" />
                </div>
            </div>
        </div>
    );
}
