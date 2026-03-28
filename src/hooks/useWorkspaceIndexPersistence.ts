import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useSettingsStore } from "@/stores/settingsStore";

export function useWorkspaceIndexPersistence() {
    const persistentWorkspaceIndexEnabled = useSettingsStore(
        (state) => state.persistentWorkspaceIndexEnabled
    );

    useEffect(() => {
        invoke("set_workspace_index_persistence_enabled", {
            enabled: persistentWorkspaceIndexEnabled,
        }).catch((error) => {
            console.error("Failed to sync workspace index persistence setting:", error);
        });
    }, [persistentWorkspaceIndexEnabled]);
}
