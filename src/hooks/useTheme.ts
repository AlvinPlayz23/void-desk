import { useEffect } from "react";
import { useUIStore } from "@/stores/uiStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function useTheme() {
    const theme = useUIStore((state) => state.theme);
    const uiScale = useSettingsStore((state) => state.uiScale);

    useEffect(() => {
        document.documentElement.setAttribute("data-theme", theme);
    }, [theme]);

    useEffect(() => {
        document.documentElement.style.fontSize = `${(uiScale / 100) * 14}px`;
    }, [uiScale]);

    return theme;
}
