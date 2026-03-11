import { useEffect, useRef, useCallback } from "react";
import { Search, Filter, ChevronDown, ChevronRight, FileCode, Loader2, X, Check, ArrowRightLeft } from "lucide-react";
import { useSearchStore } from "@/stores/searchStore";
import { useFileStore } from "@/stores/fileStore";
import { useFileSystem } from "@/hooks/useFileSystem";

const fileColorMap: Record<string, string> = {
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

const getRelativePath = (fullPath: string, rootPath: string) => {
    const normalized = fullPath.replace(/\\/g, "/");
    const normalizedRoot = rootPath.replace(/\\/g, "/");
    if (normalized.startsWith(normalizedRoot)) {
        return normalized.slice(normalizedRoot.length + 1);
    }
    return normalized;
};

const highlightMatch = (lineText: string, matchText: string) => {
    const idx = lineText.indexOf(matchText);
    if (idx === -1) return <span>{lineText}</span>;
    return (
        <>
            <span>{lineText.slice(0, idx)}</span>
            <span className="bg-[var(--color-accent-primary)]/25 text-[var(--color-accent-primary)] rounded-sm px-0.5">{matchText}</span>
            <span>{lineText.slice(idx + matchText.length)}</span>
        </>
    );
};

export function SearchPanel() {
    const {
        query,
        replaceText,
        isRegex,
        caseSensitive,
        filePattern,
        results,
        isSearching,
        error,
        selectedMatches,
        expandedFiles,
        showReplace,
        setQuery,
        setReplaceText,
        setIsRegex,
        setCaseSensitive,
        setFilePattern,
        setShowReplace,
        runSearch,
        clearResults,
        toggleMatch,
        toggleFileMatches,
        selectAll,
        deselectAll,
        toggleFileExpanded,
        replaceSelected,
        replaceAll,
    } = useSearchStore();

    const rootPath = useFileStore((s) => s.rootPath);
    const { openFileInEditor } = useFileSystem();
    const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const debouncedSearch = useCallback(() => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            runSearch();
        }, 300);
    }, [runSearch]);

    useEffect(() => {
        return () => {
            if (debounceRef.current) clearTimeout(debounceRef.current);
        };
    }, []);

    useEffect(() => {
        inputRef.current?.focus();
    }, []);

    const handleQueryChange = (value: string) => {
        setQuery(value);
        if (value.trim()) {
            debouncedSearch();
        } else {
            clearResults();
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter") {
            if (debounceRef.current) clearTimeout(debounceRef.current);
            runSearch();
        }
    };

    const handleMatchClick = async (filePath: string, _line: number) => {
        const name = filePath.split(/[\\/]/).pop() || filePath;
        await openFileInEditor(filePath, name);
    };

    const selectedCount = Object.values(selectedMatches).filter(Boolean).length;

    const getFileExt = (path: string) => {
        const name = path.split(/[\\/]/).pop() || "";
        return name.split(".").pop()?.toLowerCase() || "";
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Search inputs */}
            <div className="flex flex-col gap-1.5 p-2 border-b border-[var(--color-border-subtle)]">
                {/* Find row */}
                <div className="flex items-center gap-1">
                    <button
                        className="flex-shrink-0 p-1 rounded hover:bg-[var(--color-void-700)] transition-colors"
                        onClick={() => setShowReplace(!showReplace)}
                        title={showReplace ? "Hide replace" : "Show replace"}
                    >
                        {showReplace ? (
                            <ChevronDown className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                        ) : (
                            <ChevronRight className="w-3.5 h-3.5 text-[var(--color-text-secondary)]" />
                        )}
                    </button>
                    <div className="flex-1 flex items-center bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] focus-within:border-[var(--color-accent-primary)] rounded px-2 py-1 gap-1.5">
                        <Search className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
                        <input
                            ref={inputRef}
                            type="text"
                            value={query}
                            onChange={(e) => handleQueryChange(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Search"
                            className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                        />
                        {query && (
                            <button
                                className="p-0.5 rounded hover:bg-[var(--color-void-700)]"
                                onClick={() => { setQuery(""); clearResults(); }}
                            >
                                <X className="w-3 h-3 text-[var(--color-text-muted)]" />
                            </button>
                        )}
                    </div>
                    <button
                        className={`flex-shrink-0 px-1.5 py-1 rounded text-[10px] font-mono font-bold transition-colors ${
                            isRegex
                                ? "bg-[var(--color-void-700)] text-[var(--color-accent-primary)]"
                                : "text-[var(--color-text-muted)] hover:bg-[var(--color-void-700)]"
                        }`}
                        onClick={() => setIsRegex(!isRegex)}
                        title="Use regular expression"
                    >
                        .*
                    </button>
                    <button
                        className={`flex-shrink-0 px-1.5 py-1 rounded text-[10px] font-bold transition-colors ${
                            caseSensitive
                                ? "bg-[var(--color-void-700)] text-[var(--color-accent-primary)]"
                                : "text-[var(--color-text-muted)] hover:bg-[var(--color-void-700)]"
                        }`}
                        onClick={() => setCaseSensitive(!caseSensitive)}
                        title="Match case"
                    >
                        Aa
                    </button>
                </div>

                {/* Replace row */}
                {showReplace && (
                    <div className="flex items-center gap-1 pl-6">
                        <div className="flex-1 flex items-center bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] focus-within:border-[var(--color-accent-primary)] rounded px-2 py-1 gap-1.5">
                            <ArrowRightLeft className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
                            <input
                                type="text"
                                value={replaceText}
                                onChange={(e) => setReplaceText(e.target.value)}
                                placeholder="Replace"
                                className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                            />
                        </div>
                    </div>
                )}

                {/* File pattern */}
                <div className="flex items-center gap-1 pl-6">
                    <div className="flex-1 flex items-center bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] focus-within:border-[var(--color-accent-primary)] rounded px-2 py-1 gap-1.5">
                        <Filter className="w-3.5 h-3.5 text-[var(--color-text-muted)] flex-shrink-0" />
                        <input
                            type="text"
                            value={filePattern}
                            onChange={(e) => setFilePattern(e.target.value)}
                            placeholder="e.g. *.ts, !node_modules"
                            className="flex-1 bg-transparent text-xs text-[var(--color-text-primary)] outline-none placeholder:text-[var(--color-text-muted)]"
                        />
                    </div>
                </div>

                {/* Replace actions */}
                {showReplace && results && results.total_matches > 0 && (
                    <div className="flex items-center gap-1.5 pl-6">
                        <button
                            className="px-2 py-1 text-[10px] rounded bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-600)] transition-colors disabled:opacity-40"
                            onClick={replaceSelected}
                            disabled={isSearching || selectedCount === 0}
                        >
                            Replace Selected ({selectedCount})
                        </button>
                        <button
                            className="px-2 py-1 text-[10px] rounded bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-600)] transition-colors disabled:opacity-40"
                            onClick={replaceAll}
                            disabled={isSearching}
                        >
                            Replace All
                        </button>
                    </div>
                )}
            </div>

            {/* Results */}
            <div className="flex-1 overflow-y-auto">
                {/* Summary */}
                {isSearching && (
                    <div className="flex items-center gap-2 px-3 py-2 text-xs text-[var(--color-text-secondary)]">
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Searching...
                    </div>
                )}

                {error && (
                    <div className="px-3 py-2 text-xs text-red-400">
                        {error}
                    </div>
                )}

                {results && !isSearching && (
                    <>
                        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-[var(--color-text-secondary)]">
                            <span>
                                {results.total_matches} result{results.total_matches !== 1 ? "s" : ""} in {results.files.length} file{results.files.length !== 1 ? "s" : ""}
                            </span>
                            <div className="flex items-center gap-1">
                                <button
                                    className="p-0.5 rounded hover:bg-[var(--color-void-700)] text-[var(--color-text-muted)]"
                                    onClick={selectAll}
                                    title="Select all"
                                >
                                    <Check className="w-3 h-3" />
                                </button>
                                <button
                                    className="p-0.5 rounded hover:bg-[var(--color-void-700)] text-[var(--color-text-muted)]"
                                    onClick={deselectAll}
                                    title="Deselect all"
                                >
                                    <X className="w-3 h-3" />
                                </button>
                            </div>
                        </div>

                        {results.truncated && (
                            <div className="px-3 py-1 text-[10px] text-yellow-500">
                                Results truncated — refine your search
                            </div>
                        )}

                        {/* File groups */}
                        {results.files.map((file) => {
                            const expanded = expandedFiles[file.path] !== false;
                            const relPath = rootPath ? getRelativePath(file.path, rootPath) : file.path;
                            const ext = getFileExt(file.path);
                            const fileSelected = file.matches.every((m) => selectedMatches[m.id]);
                            const fileSomeSelected = file.matches.some((m) => selectedMatches[m.id]);

                            return (
                                <div key={file.path}>
                                    {/* File header */}
                                    <div
                                        className="flex items-center gap-1 px-2 py-1 cursor-pointer hover:bg-[var(--color-void-800)] group"
                                        onClick={() => toggleFileExpanded(file.path)}
                                    >
                                        {expanded ? (
                                            <ChevronDown className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" />
                                        ) : (
                                            <ChevronRight className="w-3 h-3 text-[var(--color-text-muted)] flex-shrink-0" />
                                        )}
                                        <input
                                            type="checkbox"
                                            checked={fileSelected}
                                            ref={(el) => {
                                                if (el) el.indeterminate = fileSomeSelected && !fileSelected;
                                            }}
                                            onChange={(e) => {
                                                e.stopPropagation();
                                                toggleFileMatches(file.path);
                                            }}
                                            onClick={(e) => e.stopPropagation()}
                                            className="w-3 h-3 flex-shrink-0 accent-[var(--color-accent-primary)]"
                                        />
                                        <FileCode
                                            className="w-3.5 h-3.5 flex-shrink-0"
                                            style={{ color: fileColorMap[ext] || "var(--color-text-tertiary)" }}
                                        />
                                        <span className="text-[11px] text-[var(--color-text-secondary)] truncate flex-1">
                                            {relPath}
                                        </span>
                                        <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0 ml-1">
                                            {file.matches.length}
                                        </span>
                                    </div>

                                    {/* Matches */}
                                    {expanded && file.matches.map((match) => (
                                        <div
                                            key={match.id}
                                            className="flex items-start gap-1.5 pl-8 pr-2 py-0.5 cursor-pointer hover:bg-[var(--color-void-800)]/60 group"
                                            onClick={() => handleMatchClick(file.path, match.line)}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={!!selectedMatches[match.id]}
                                                onChange={() => toggleMatch(match.id)}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-3 h-3 flex-shrink-0 mt-0.5 accent-[var(--color-accent-primary)]"
                                            />
                                            <span className="text-[10px] text-[var(--color-text-muted)] flex-shrink-0 w-6 text-right mt-px">
                                                {match.line}
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <div className="text-[11px] text-[var(--color-text-primary)] truncate font-mono leading-relaxed">
                                                    {highlightMatch(match.line_text.trim(), match.match_text)}
                                                </div>
                                                {match.replacement_preview !== null && (
                                                    <div className="text-[10px] leading-relaxed mt-0.5">
                                                        <span className="line-through text-[var(--color-text-muted)]">{match.match_text}</span>
                                                        <span className="text-[var(--color-text-muted)] mx-1">→</span>
                                                        <span className="text-green-400">{match.replacement_preview}</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            );
                        })}
                    </>
                )}

                {/* Empty state */}
                {!results && !isSearching && !error && query === "" && (
                    <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center">
                        Type to search across all files
                    </div>
                )}
            </div>
        </div>
    );
}
