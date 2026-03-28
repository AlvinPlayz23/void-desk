import { useDiagnosticsStore } from "@/stores/diagnosticsStore";
import { useUIStore } from "@/stores/uiStore";
import { ActivityBarAlignment } from "@/stores/settingsStore";
import { FolderOpen, Search, AlertTriangle, Route } from "lucide-react";

interface SidebarNavProps {
    mode: "integrated" | "activity_bar";
    alignment: ActivityBarAlignment;
}

export function SidebarNav({ mode, alignment }: SidebarNavProps) {
    const sidebarView = useUIStore((state) => state.sidebarView);
    const setSidebarView = useUIStore((state) => state.setSidebarView);
    const diagnosticsByPath = useDiagnosticsStore((state) => state.diagnosticsByPath);
    const errorCount = Object.values(diagnosticsByPath)
        .flat()
        .filter((diagnostic) => diagnostic.severity === 1).length;

    const items = [
        { id: "explorer" as const, title: "Explorer", icon: FolderOpen },
        { id: "search" as const, title: "Search", icon: Search },
        { id: "problems" as const, title: "Problems", icon: AlertTriangle, showErrorDot: errorCount > 0 },
        { id: "symbols" as const, title: "Symbol Results", icon: Route },
    ];

    return (
        <div
            className={`flex ${mode === "activity_bar" ? "flex-col w-12 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]" : "flex-row"} ${
                alignment === "bottom" ? "justify-end" : "justify-start"
            }`}
        >
            <div className={`flex ${mode === "activity_bar" ? "flex-col gap-1 p-2 min-h-full" : "flex-row gap-1"}`}>
                {items.map((item) => {
                    const Icon = item.icon;
                    const active = sidebarView === item.id;
                    return (
                        <button
                            key={item.id}
                            onClick={() => setSidebarView(item.id)}
                            className={`icon-btn relative ${active ? "text-[var(--color-text-primary)] bg-[var(--color-void-700)]" : ""}`}
                            title={item.title}
                        >
                            <Icon className="w-3.5 h-3.5" />
                            {item.showErrorDot && (
                                <span className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full bg-[var(--color-accent-error)] shadow-[0_0_0_2px_var(--color-surface-elevated)]" />
                            )}
                        </button>
                    );
                })}
            </div>
        </div>
    );
}
