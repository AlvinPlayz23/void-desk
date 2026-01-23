import { useRef, useCallback } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useFileStore } from "@/stores/fileStore";
import { Sidebar } from "./Sidebar";
import { StatusBar } from "./StatusBar";
import { CodeEditor } from "@/components/editor/CodeEditor";
import { EditorTabs } from "@/components/editor/EditorTabs";
import { AIChat } from "@/components/ai/AIChat";
import { TerminalComponent } from "@/components/terminal/TerminalComponent";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { SettingsModal } from "@/components/ui/SettingsModal";
import { MessageSquare, PanelLeftClose, PanelLeft, Terminal as TerminalIcon, X } from "lucide-react";

export function MainLayout() {
    const {
        sidebarWidth,
        aiPanelWidth,
        terminalHeight,
        isSidebarVisible,
        isAIPanelVisible,
        isTerminalVisible,
        setSidebarWidth,
        setAIPanelWidth,
        setTerminalHeight,
        toggleSidebar,
        toggleAIPanel,
        toggleTerminal,
    } = useUIStore();

    const { openFiles } = useFileStore();

    const sidebarRef = useRef<HTMLDivElement>(null);
    const aiPanelRef = useRef<HTMLDivElement>(null);

    // Resize handlers
    const handleSidebarResize = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = sidebarWidth;

            const onMouseMove = (e: MouseEvent) => {
                const delta = e.clientX - startX;
                setSidebarWidth(startWidth + delta);
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        },
        [sidebarWidth, setSidebarWidth]
    );

    const handleAIPanelResize = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            const startX = e.clientX;
            const startWidth = aiPanelWidth;

            const onMouseMove = (e: MouseEvent) => {
                const delta = startX - e.clientX;
                setAIPanelWidth(startWidth + delta);
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "col-resize";
            document.body.style.userSelect = "none";
        },
        [aiPanelWidth, setAIPanelWidth]
    );

    const handleTerminalResize = useCallback(
        (e: React.MouseEvent) => {
            e.preventDefault();
            const startY = e.clientY;
            const startHeight = terminalHeight;

            const onMouseMove = (e: MouseEvent) => {
                const delta = startY - e.clientY;
                setTerminalHeight(startHeight + delta);
            };

            const onMouseUp = () => {
                document.removeEventListener("mousemove", onMouseMove);
                document.removeEventListener("mouseup", onMouseUp);
                document.body.style.cursor = "";
                document.body.style.userSelect = "";
            };

            document.addEventListener("mousemove", onMouseMove);
            document.addEventListener("mouseup", onMouseUp);
            document.body.style.cursor = "row-resize";
            document.body.style.userSelect = "none";
        },
        [terminalHeight, setTerminalHeight]
    );

    return (
        <div className="flex flex-col h-screen bg-[var(--color-surface-base)]">
            {/* Main Content Area */}
            <div className="flex flex-1 overflow-hidden">
                {/* Sidebar */}
                {isSidebarVisible && (
                    <>
                        <div
                            ref={sidebarRef}
                            className="flex-shrink-0 bg-[var(--color-surface-elevated)] border-r border-[var(--color-border-subtle)]"
                            style={{ width: sidebarWidth }}
                        >
                            <Sidebar />
                        </div>
                        <div
                            className="resize-handle resize-handle-vertical"
                            onMouseDown={handleSidebarResize}
                        />
                    </>
                )}

                {/* Editor Area */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {/* Toolbar */}
                    <div className="flex items-center justify-between h-10 px-2 bg-[var(--color-surface-elevated)] border-b border-[var(--color-border-subtle)]">
                        <div className="flex items-center gap-1">
                            <button
                                onClick={toggleSidebar}
                                className="icon-btn"
                                title={isSidebarVisible ? "Hide Sidebar" : "Show Sidebar"}
                            >
                                {isSidebarVisible ? (
                                    <PanelLeftClose className="w-4 h-4" />
                                ) : (
                                    <PanelLeft className="w-4 h-4" />
                                )}
                            </button>
                        </div>

                        <div className="flex items-center gap-1">
                            <button
                                onClick={toggleTerminal}
                                className={`icon-btn ${isTerminalVisible ? "text-[var(--color-accent-primary)]" : ""}`}
                                title="Toggle Terminal"
                            >
                                <TerminalIcon className="w-4 h-4" />
                            </button>
                            <button
                                onClick={toggleAIPanel}
                                className={`icon-btn ${isAIPanelVisible ? "text-[var(--color-accent-primary)]" : ""}`}
                                title="Toggle AI Panel"
                            >
                                <MessageSquare className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    {/* Tabs */}
                    {openFiles.length > 0 && <EditorTabs />}

                    {/* Editor */}
                    <div className="flex-1 overflow-hidden">
                        <CodeEditor />
                    </div>

                    {/* Terminal Panel */}
                    {isTerminalVisible && (
                        <div
                            className="flex-shrink-0 flex flex-col bg-[var(--color-void-850)] border-t border-[var(--color-border-subtle)]"
                            style={{ height: terminalHeight }}
                        >
                            <div
                                className="resize-handle resize-handle-horizontal"
                                onMouseDown={handleTerminalResize}
                            />
                            <div className="flex items-center justify-between px-3 py-1 bg-white/[0.02] border-b border-white/5">
                                <div className="flex items-center gap-2">
                                    <TerminalIcon className="w-3.5 h-3.5 text-[var(--color-text-tertiary)]" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest opacity-50">Terminal</span>
                                </div>
                                <button onClick={toggleTerminal} className="opacity-30 hover:opacity-100 transition-opacity">
                                    <X className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div className="flex-1 overflow-hidden">
                                <TerminalComponent />
                            </div>
                        </div>
                    )}
                </div>

                {/* AI Panel */}
                {isAIPanelVisible && (
                    <>
                        <div
                            className="resize-handle resize-handle-vertical"
                            onMouseDown={handleAIPanelResize}
                        />
                        <div
                            ref={aiPanelRef}
                            className="flex-shrink-0 bg-[var(--color-surface-elevated)] border-l border-[var(--color-border-subtle)]"
                            style={{ width: aiPanelWidth }}
                        >
                            <AIChat />
                        </div>
                    </>
                )}
            </div>

            {/* Status Bar */}
            <StatusBar />

            {/* Global Overlay Components */}
            <CommandPalette />
            <SettingsModal />
        </div>
    );
}
