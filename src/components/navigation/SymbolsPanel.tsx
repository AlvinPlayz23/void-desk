import { MapPin, Search } from "lucide-react";

import { useNavigationStore } from "@/stores/navigationStore";
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

export function SymbolsPanel() {
    const { symbolResults, symbolMode, clearSymbolResults } = useNavigationStore();
    const rootPath = useFileStore((state) => state.rootPath);
    const { openFileAtLocation } = useFileSystem();

    if (!symbolMode || symbolResults.length === 0) {
        return (
            <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center">
                No symbol results
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full overflow-y-auto">
            <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-subtle)]">
                <div className="flex items-center gap-2 text-[11px] text-[var(--color-text-secondary)] uppercase tracking-widest">
                    {symbolMode === "definition" ? <MapPin className="w-3 h-3" /> : <Search className="w-3 h-3" />}
                    <span>{symbolMode === "definition" ? "Definitions" : "References"}</span>
                    <span className="text-[var(--color-text-muted)]">{symbolResults.length}</span>
                </div>
                <button
                    className="text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                    onClick={clearSymbolResults}
                >
                    Clear
                </button>
            </div>

            {symbolResults.map((result, index) => {
                const name = result.path.split(/[\\/]/).pop() || result.path;
                return (
                    <button
                        key={`${result.path}-${index}-${result.range.start.line}-${result.range.start.character}`}
                        className="w-full px-3 py-2 text-left border-b border-[var(--color-border-subtle)]/60 hover:bg-[var(--color-void-800)] transition-colors"
                        onClick={() =>
                            openFileAtLocation(
                                result.path,
                                name,
                                result.range.start.line + 1,
                                result.range.start.character + 1,
                                result.range.end.line + 1,
                                result.range.end.character + 1
                            )
                        }
                    >
                        <div className="text-[11px] text-[var(--color-text-secondary)] truncate">
                            {getRelativePath(result.path, rootPath)}
                        </div>
                        <div className="mt-1 text-xs text-[var(--color-text-primary)] font-mono truncate">
                            {result.preview || result.lineText || "(empty line)"}
                        </div>
                        <div className="mt-1 text-[10px] text-[var(--color-text-muted)] font-mono">
                            Ln {result.range.start.line + 1}, Col {result.range.start.character + 1}
                        </div>
                    </button>
                );
            })}
        </div>
    );
}
