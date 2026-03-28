import { invoke } from "@tauri-apps/api/core";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { useEffect } from "react";

import { LspDiagnostic, useDiagnosticsStore } from "@/stores/diagnosticsStore";
import { useFileStore } from "@/stores/fileStore";

interface DiagnosticsEventPayload {
    path: string;
    diagnostics: LspDiagnostic[];
}

export function useLspDiagnostics() {
    const rootPath = useFileStore((state) => state.rootPath);

    useEffect(() => {
        useDiagnosticsStore.getState().clearDiagnostics();
    }, [rootPath]);

    useEffect(() => {
        let unlisten: UnlistenFn | null = null;

        const setup = async () => {
            try {
                const diagnostics = await invoke<LspDiagnostic[]>("lsp_list_diagnostics");
                useDiagnosticsStore.getState().hydrateDiagnostics(diagnostics);
            } catch (error) {
                console.error("Failed to hydrate LSP diagnostics:", error);
            }

            try {
                unlisten = await listen<DiagnosticsEventPayload>("lsp://diagnostics", (event) => {
                    useDiagnosticsStore
                        .getState()
                        .setDiagnosticsForPath(event.payload.path, event.payload.diagnostics);
                });
            } catch (error) {
                console.error("Failed to listen for LSP diagnostics:", error);
            }
        };

        setup();

        return () => {
            if (unlisten) {
                unlisten();
            }
        };
    }, []);
}
