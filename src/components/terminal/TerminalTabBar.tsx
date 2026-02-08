import { Plus, X, Columns2, Rows2, Terminal as TerminalIcon } from "lucide-react";
import { useTerminalStore } from "@/stores/terminalStore";

export function TerminalTabBar() {
    const { tabs, activeTabId, setActiveTab, createTab, closeTab, splitPane } =
        useTerminalStore();

    const splitActivePane = (direction: "horizontal" | "vertical") => {
        const activeTab = tabs.find((t) => t.id === activeTabId);
        if (activeTab && activeTabId) {
            splitPane(activeTabId, activeTab.activePaneId, direction);
        }
    };

    return (
        <div className="flex items-center justify-between px-3 py-1 bg-white/[0.02] border-b border-white/5">
            <div className="flex items-center gap-0.5 overflow-x-auto">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        className={`group flex items-center gap-1.5 px-3 py-1 text-[10px] font-medium uppercase tracking-wider rounded-sm transition-colors ${
                            tab.id === activeTabId
                                ? "bg-white/[0.08] text-[var(--color-text-primary)]"
                                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-white/[0.04]"
                        }`}
                        onClick={() => setActiveTab(tab.id)}
                    >
                        <TerminalIcon className="w-3 h-3" />
                        <span>{tab.title}</span>
                        {tabs.length > 1 && (
                            <X
                                className="w-3 h-3 opacity-0 group-hover:opacity-60 hover:!opacity-100"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeTab(tab.id);
                                }}
                            />
                        )}
                    </button>
                ))}
                <button
                    onClick={createTab}
                    className="icon-btn w-6 h-6"
                    title="New Terminal"
                >
                    <Plus className="w-3.5 h-3.5" />
                </button>
            </div>
            <div className="flex items-center gap-1">
                <button
                    onClick={() => splitActivePane("vertical")}
                    className="icon-btn w-6 h-6"
                    title="Split Right"
                >
                    <Columns2 className="w-3.5 h-3.5" />
                </button>
                <button
                    onClick={() => splitActivePane("horizontal")}
                    className="icon-btn w-6 h-6"
                    title="Split Down"
                >
                    <Rows2 className="w-3.5 h-3.5" />
                </button>
            </div>
        </div>
    );
}
