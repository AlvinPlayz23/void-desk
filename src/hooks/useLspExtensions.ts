import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect } from "react";

import { useLspExtensionsStore, type LspExtensionStatus, type LspInstallProvider } from "@/stores/lspExtensionsStore";
import { useSettingsStore } from "@/stores/settingsStore";

export function useLspExtensions() {
    const extensions = useLspExtensionsStore((state) => state.extensions);
    const isLoading = useLspExtensionsStore((state) => state.isLoading);
    const isEnsuringDefaults = useLspExtensionsStore((state) => state.isEnsuringDefaults);
    const hasEnsuredDefaults = useLspExtensionsStore((state) => state.hasEnsuredDefaults);
    const installInFlightIds = useLspExtensionsStore((state) => state.installInFlightIds);
    const setExtensions = useLspExtensionsStore((state) => state.setExtensions);
    const setIsLoading = useLspExtensionsStore((state) => state.setIsLoading);
    const setIsEnsuringDefaults = useLspExtensionsStore((state) => state.setIsEnsuringDefaults);
    const setHasEnsuredDefaults = useLspExtensionsStore((state) => state.setHasEnsuredDefaults);
    const markInstalling = useLspExtensionsStore((state) => state.markInstalling);
    const lspInstallProvider = useSettingsStore((state) => state.lspInstallProvider);

    const refreshExtensions = useCallback(async () => {
        setIsLoading(true);
        try {
            const result = await invoke<LspExtensionStatus[]>("lsp_list_extensions");
            setExtensions(result);
        } catch (error) {
            console.error("Failed to load LSP extensions:", error);
        } finally {
            setIsLoading(false);
        }
    }, [setExtensions, setIsLoading]);

    const installExtension = useCallback(
        async (id: string, installProvider: LspInstallProvider) => {
            markInstalling(id, true);
            try {
                const result = await invoke<LspExtensionStatus>("lsp_install_extension", {
                    extensionId: id,
                    installProvider,
                });
                setExtensions(
                    useLspExtensionsStore.getState().extensions.map((extension) =>
                        extension.id === id ? result : extension
                    )
                );
                await refreshExtensions();
            } finally {
                markInstalling(id, false);
            }
        },
        [markInstalling, refreshExtensions, setExtensions]
    );

    const uninstallExtension = useCallback(
        async (id: string) => {
            markInstalling(id, true);
            try {
                await invoke("lsp_uninstall_extension", { extensionId: id });
                await refreshExtensions();
            } finally {
                markInstalling(id, false);
            }
        },
        [markInstalling, refreshExtensions]
    );

    const updateExtension = useCallback(
        async (id: string, installProvider: LspInstallProvider) => {
            markInstalling(id, true);
            try {
                const result = await invoke<LspExtensionStatus>("lsp_update_extension", {
                    extensionId: id,
                    installProvider,
                });
                setExtensions(
                    useLspExtensionsStore.getState().extensions.map((extension) =>
                        extension.id === id ? result : extension
                    )
                );
                await refreshExtensions();
            } finally {
                markInstalling(id, false);
            }
        },
        [markInstalling, refreshExtensions, setExtensions]
    );

    const ensureDefaultExtensions = useCallback(
        async (installProvider: LspInstallProvider, extensionStatuses: LspExtensionStatus[]) => {
            const pendingIds = extensionStatuses
                .filter((extension) => extension.bundled_by_default && !extension.coming_soon && extension.install_source !== "managed")
                .map((extension) => extension.id);

            if (pendingIds.length === 0) {
                setHasEnsuredDefaults(true);
                return;
            }

            setIsEnsuringDefaults(true);
            pendingIds.forEach((id) => markInstalling(id, true));
            try {
                const result = await invoke<LspExtensionStatus[]>("lsp_ensure_default_extensions", {
                    installProvider,
                });
                setExtensions(result);
            } catch (error) {
                console.error("Failed to ensure bundled LSP extensions:", error);
            } finally {
                pendingIds.forEach((id) => markInstalling(id, false));
                setIsEnsuringDefaults(false);
                setHasEnsuredDefaults(true);
            }
        },
        [markInstalling, setExtensions, setHasEnsuredDefaults, setIsEnsuringDefaults]
    );

    useEffect(() => {
        refreshExtensions();
    }, [refreshExtensions]);

    useEffect(() => {
        if (isLoading || isEnsuringDefaults || hasEnsuredDefaults || extensions.length === 0) {
            return;
        }

        void ensureDefaultExtensions(lspInstallProvider, extensions);
    }, [ensureDefaultExtensions, extensions, hasEnsuredDefaults, isEnsuringDefaults, isLoading, lspInstallProvider]);

    return {
        extensions,
        isLoading,
        isEnsuringDefaults,
        installInFlightIds,
        refreshExtensions,
        installExtension,
        updateExtension,
        uninstallExtension,
    };
}
