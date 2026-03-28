import { AlertCircle, AlertTriangle, ChevronRight, Info } from "lucide-react";

import { useDiagnosticsStore, getDiagnosticSeverityBucket } from "@/stores/diagnosticsStore";
import { useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";

function getRelativePath(fullPath: string, rootPath: string | null) {
    if (!rootPath) return fullPath;

    const normalized = fullPath.replace(/\\/g, "/");
    const normalizedRoot = rootPath.replace(/\\/g, "/");
    if (normalized.startsWith(normalizedRoot)) {
        return normalized.slice(normalizedRoot.length + 1);
    }

    return normalized;
}

export function ProblemsPanel() {
    const diagnosticsByPath = useDiagnosticsStore((state) => state.diagnosticsByPath);
    const rootPath = useFileStore((state) => state.rootPath);
    const { openFileAtLocation } = useFileSystem();

    const files = Object.entries(diagnosticsByPath).sort(([left], [right]) => left.localeCompare(right));
    const totalProblems = files.reduce((sum, [, diagnostics]) => sum + diagnostics.length, 0);

    if (totalProblems === 0) {
        return (
            <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center">
                No problems detected
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="px-3 py-2 text-[11px] text-[var(--color-text-secondary)] border-b border-[var(--color-border-subtle)]">
                {totalProblems} problem{totalProblems !== 1 ? "s" : ""} across {files.length} file{files.length !== 1 ? "s" : ""}
            </div>

            {files.map(([path, diagnostics]) => {
                const name = path.split(/[\\/]/).pop() || path;
                return (
                    <div key={path} className="border-b border-[var(--color-border-subtle)]/60">
                        <div className="flex items-center gap-2 px-3 py-2 text-[11px] text-[var(--color-text-secondary)] bg-white/[0.02]">
                            <ChevronRight className="w-3 h-3 opacity-50" />
                            <span className="truncate">{getRelativePath(path, rootPath)}</span>
                            <span className="ml-auto text-[10px] text-[var(--color-text-muted)]">{diagnostics.length}</span>
                        </div>

                        {diagnostics.map((diagnostic, index) => {
                            const severity = getDiagnosticSeverityBucket(diagnostic.severity);
                            const Icon =
                                severity === "error"
                                    ? AlertCircle
                                    : severity === "warning"
                                      ? AlertTriangle
                                      : Info;

                            return (
                                <button
                                    key={`${path}-${index}-${diagnostic.message}`}
                                    className="w-full flex items-start gap-2 px-3 py-2 text-left hover:bg-[var(--color-void-800)] transition-colors"
                                    onClick={() =>
                                        openFileAtLocation(
                                            path,
                                            name,
                                            diagnostic.range.start.line + 1,
                                            diagnostic.range.start.character + 1,
                                            diagnostic.range.end.line + 1,
                                            diagnostic.range.end.character + 1
                                        )
                                    }
                                >
                                    <Icon
                                        className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${
                                            severity === "error"
                                                ? "text-[var(--color-accent-error)]"
                                                : severity === "warning"
                                                  ? "text-[var(--color-accent-warning)]"
                                                  : "text-[var(--color-accent-info)]"
                                        }`}
                                    />
                                    <div className="min-w-0 flex-1">
                                        <div className="text-xs text-[var(--color-text-primary)] leading-relaxed">
                                            {diagnostic.message}
                                        </div>
                                        <div className="mt-1 text-[10px] text-[var(--color-text-muted)] font-mono">
                                            Ln {diagnostic.range.start.line + 1}, Col {diagnostic.range.start.character + 1}
                                            {diagnostic.source ? ` • ${diagnostic.source}` : ""}
                                            {diagnostic.code ? ` • ${diagnostic.code}` : ""}
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                );
            })}
        </div>
    );
}
