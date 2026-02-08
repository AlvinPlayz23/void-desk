import { useEffect } from "react";
import { useTerminalStore } from "@/stores/terminalStore";
import { TerminalTabBar } from "./TerminalTabBar";
import { TerminalSplitView } from "./TerminalSplitView";

export function TerminalPanel() {
    const { tabs, activeTabId, ensureDefaultTab } = useTerminalStore();

    useEffect(() => {
        ensureDefaultTab();
    }, []);

    const activeTab = tabs.find((t) => t.id === activeTabId);

    return (
        <div className="flex flex-col h-full bg-[#0d0d14]">
            <TerminalTabBar />
            <div className="flex-1 overflow-hidden">
                {activeTab && (
                    <TerminalSplitView
                        node={activeTab.root}
                        tabId={activeTab.id}
                        activePaneId={activeTab.activePaneId}
                    />
                )}
            </div>
        </div>
    );
}
