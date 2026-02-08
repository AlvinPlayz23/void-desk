import { useTerminalStore, TerminalLayoutNode } from "@/stores/terminalStore";
import { TerminalPane } from "./TerminalPane";

interface TerminalSplitViewProps {
    node: TerminalLayoutNode;
    tabId: string;
    activePaneId: string;
}

export function TerminalSplitView({ node, tabId, activePaneId }: TerminalSplitViewProps) {
    const { setActivePaneInTab } = useTerminalStore();

    if (node.type === "leaf") {
        return (
            <TerminalPane
                paneId={node.paneId}
                isActive={node.paneId === activePaneId}
                onFocus={() => setActivePaneInTab(tabId, node.paneId)}
            />
        );
    }

    const isVertical = node.direction === "vertical";
    const handleClass = isVertical
        ? "resize-handle resize-handle-vertical"
        : "resize-handle resize-handle-horizontal";

    return (
        <div
            className={`flex h-full w-full ${isVertical ? "flex-row" : "flex-col"}`}
        >
            <div style={{ flex: node.ratio }} className="overflow-hidden">
                <TerminalSplitView
                    node={node.a}
                    tabId={tabId}
                    activePaneId={activePaneId}
                />
            </div>
            <div className={handleClass} />
            <div style={{ flex: 1 - node.ratio }} className="overflow-hidden">
                <TerminalSplitView
                    node={node.b}
                    tabId={tabId}
                    activePaneId={activePaneId}
                />
            </div>
        </div>
    );
}
