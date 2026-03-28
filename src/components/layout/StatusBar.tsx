import { useFileStore } from "@/stores/fileStore";
import { useEditorStore } from "@/stores/editorStore";
import { useDiagnosticsStore } from "@/stores/diagnosticsStore";
import { useUIStore } from "@/stores/uiStore";
import { useShallow } from "zustand/react/shallow";
import {
    GitBranch,
    AlertCircle,
    AlertTriangle,
    Bell,
    Check,
} from "lucide-react";

export function StatusBar() {
    const { openFiles, currentFilePath } = useFileStore(
        useShallow((state) => ({
            openFiles: state.openFiles,
            currentFilePath: state.currentFilePath,
        }))
    );
    const { cursorLine, cursorColumn } = useEditorStore(
        useShallow((state) => ({
            cursorLine: state.cursorLine,
            cursorColumn: state.cursorColumn,
        }))
    );
    const diagnosticsByPath = useDiagnosticsStore((state) => state.diagnosticsByPath);
    const openSidebar = useUIStore((state) => state.openSidebar);
    const setSidebarView = useUIStore((state) => state.setSidebarView);

    const currentFile = openFiles.find((f) => f.path === currentFilePath);
    const diagnostics = Object.values(diagnosticsByPath).flat();
    const errorCount = diagnostics.filter((diagnostic) => diagnostic.severity === 1).length;
    const warningCount = diagnostics.filter((diagnostic) => diagnostic.severity === 2).length;

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
                <div
                    className="status-item cursor-pointer hover:bg-[var(--color-void-800)]"
                    onClick={() => {
                        openSidebar();
                        setSidebarView("problems");
                    }}
                >
                    <AlertCircle className="w-3 h-3" />
                    <span>{errorCount}</span>
                    <AlertTriangle className="w-3 h-3 ml-1" />
                    <span>{warningCount}</span>
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
