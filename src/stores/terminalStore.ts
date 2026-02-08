import { create } from "zustand";
import { persist } from "zustand/middleware";

export type SplitDirection = "horizontal" | "vertical";

export type TerminalLayoutNode =
    | { type: "leaf"; paneId: string }
    | { type: "split"; direction: SplitDirection; a: TerminalLayoutNode; b: TerminalLayoutNode; ratio: number };

export interface TerminalPane {
    id: string;
    title: string;
    pid: number | null;
}

export interface TerminalTab {
    id: string;
    title: string;
    root: TerminalLayoutNode;
    panesById: Record<string, TerminalPane>;
    activePaneId: string;
}

interface TerminalState {
    tabs: TerminalTab[];
    activeTabId: string | null;
    nextPaneNumber: number;
    nextTabNumber: number;

    createTab: () => void;
    closeTab: (tabId: string) => void;
    setActiveTab: (tabId: string) => void;
    renameTab: (tabId: string, title: string) => void;

    splitPane: (tabId: string, paneId: string, direction: SplitDirection) => void;
    closePane: (tabId: string, paneId: string) => void;
    setActivePaneInTab: (tabId: string, paneId: string) => void;
    setPanePid: (paneId: string, pid: number | null) => void;

    ensureDefaultTab: () => void;
}

function generateId(): string {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function findAndReplace(
    node: TerminalLayoutNode,
    targetPaneId: string,
    replacement: TerminalLayoutNode
): TerminalLayoutNode | null {
    if (node.type === "leaf") {
        if (node.paneId === targetPaneId) return replacement;
        return null;
    }

    const replacedA = findAndReplace(node.a, targetPaneId, replacement);
    if (replacedA) return { ...node, a: replacedA };

    const replacedB = findAndReplace(node.b, targetPaneId, replacement);
    if (replacedB) return { ...node, b: replacedB };

    return null;
}

function removePaneFromTree(
    node: TerminalLayoutNode,
    paneId: string
): TerminalLayoutNode | null {
    if (node.type === "leaf") {
        return node.paneId === paneId ? null : node;
    }

    if (node.a.type === "leaf" && node.a.paneId === paneId) return node.b;
    if (node.b.type === "leaf" && node.b.paneId === paneId) return node.a;

    const removedFromA = removePaneFromTree(node.a, paneId);
    if (removedFromA !== node.a) {
        return removedFromA ? { ...node, a: removedFromA } : node.b;
    }

    const removedFromB = removePaneFromTree(node.b, paneId);
    if (removedFromB !== node.b) {
        return removedFromB ? { ...node, b: removedFromB } : node.a;
    }

    return node;
}

function countLeaves(node: TerminalLayoutNode): number {
    if (node.type === "leaf") return 1;
    return countLeaves(node.a) + countLeaves(node.b);
}

function findFirstLeaf(node: TerminalLayoutNode): string {
    if (node.type === "leaf") return node.paneId;
    return findFirstLeaf(node.a);
}

export const useTerminalStore = create<TerminalState>()(
    persist(
        (set, get) => ({
            tabs: [],
            activeTabId: null,
            nextPaneNumber: 1,
            nextTabNumber: 1,

            createTab: () => {
                const state = get();
                const paneId = generateId();
                const tabId = generateId();
                const paneNumber = state.nextPaneNumber;
                const tabNumber = state.nextTabNumber;

                const pane: TerminalPane = {
                    id: paneId,
                    title: `Pane ${paneNumber}`,
                    pid: null,
                };

                const tab: TerminalTab = {
                    id: tabId,
                    title: `Terminal ${tabNumber}`,
                    root: { type: "leaf", paneId },
                    panesById: { [paneId]: pane },
                    activePaneId: paneId,
                };

                set({
                    tabs: [...state.tabs, tab],
                    activeTabId: tabId,
                    nextPaneNumber: paneNumber + 1,
                    nextTabNumber: tabNumber + 1,
                });
            },

            closeTab: (tabId: string) => {
                set((state) => {
                    const index = state.tabs.findIndex((t) => t.id === tabId);
                    if (index === -1) return state;

                    const tabs = state.tabs.filter((t) => t.id !== tabId);
                    let activeTabId = state.activeTabId;

                    if (activeTabId === tabId) {
                        if (tabs.length === 0) {
                            activeTabId = null;
                        } else if (index < tabs.length) {
                            activeTabId = tabs[index].id;
                        } else {
                            activeTabId = tabs[tabs.length - 1].id;
                        }
                    }

                    return { tabs, activeTabId };
                });
            },

            setActiveTab: (tabId: string) => {
                set({ activeTabId: tabId });
            },

            renameTab: (tabId: string, title: string) => {
                set((state) => ({
                    tabs: state.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)),
                }));
            },

            splitPane: (tabId: string, paneId: string, direction: SplitDirection) => {
                const state = get();
                const tab = state.tabs.find((t) => t.id === tabId);
                if (!tab) return;

                const newPaneId = generateId();
                const paneNumber = state.nextPaneNumber;

                const newPane: TerminalPane = {
                    id: newPaneId,
                    title: `Pane ${paneNumber}`,
                    pid: null,
                };

                const splitNode: TerminalLayoutNode = {
                    type: "split",
                    direction,
                    a: { type: "leaf", paneId },
                    b: { type: "leaf", paneId: newPaneId },
                    ratio: 0.5,
                };

                const newRoot = findAndReplace(tab.root, paneId, splitNode);
                if (!newRoot) return;

                set({
                    tabs: state.tabs.map((t) =>
                        t.id === tabId
                            ? {
                                  ...t,
                                  root: newRoot,
                                  panesById: { ...t.panesById, [newPaneId]: newPane },
                                  activePaneId: newPaneId,
                              }
                            : t
                    ),
                    nextPaneNumber: paneNumber + 1,
                });
            },

            closePane: (tabId: string, paneId: string) => {
                set((state) => {
                    const tab = state.tabs.find((t) => t.id === tabId);
                    if (!tab) return state;

                    if (countLeaves(tab.root) <= 1) return state;

                    const newRoot = removePaneFromTree(tab.root, paneId);
                    if (!newRoot) return state;

                    const { [paneId]: _, ...remainingPanes } = tab.panesById;
                    const activePaneId =
                        tab.activePaneId === paneId ? findFirstLeaf(newRoot) : tab.activePaneId;

                    return {
                        tabs: state.tabs.map((t) =>
                            t.id === tabId
                                ? {
                                      ...t,
                                      root: newRoot,
                                      panesById: remainingPanes,
                                      activePaneId,
                                  }
                                : t
                        ),
                    };
                });
            },

            setActivePaneInTab: (tabId: string, paneId: string) => {
                set((state) => ({
                    tabs: state.tabs.map((t) =>
                        t.id === tabId ? { ...t, activePaneId: paneId } : t
                    ),
                }));
            },

            setPanePid: (paneId: string, pid: number | null) => {
                set((state) => ({
                    tabs: state.tabs.map((t) => {
                        if (!(paneId in t.panesById)) return t;
                        return {
                            ...t,
                            panesById: {
                                ...t.panesById,
                                [paneId]: { ...t.panesById[paneId], pid },
                            },
                        };
                    }),
                }));
            },

            ensureDefaultTab: () => {
                const state = get();
                if (state.tabs.length === 0) {
                    state.createTab();
                }
            },
        }),
        {
            name: "voidesk-terminal",
            partialize: (state) => ({
                tabs: state.tabs.map((tab) => ({
                    ...tab,
                    panesById: Object.fromEntries(
                        Object.entries(tab.panesById).map(([id, pane]) => [
                            id,
                            { ...pane, pid: null },
                        ])
                    ),
                })),
                activeTabId: state.activeTabId,
                nextPaneNumber: state.nextPaneNumber,
                nextTabNumber: state.nextTabNumber,
            }),
        }
    )
);
