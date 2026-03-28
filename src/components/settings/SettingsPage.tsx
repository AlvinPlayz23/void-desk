import { useState, useEffect, useRef, useMemo } from "react";
import { useShallow } from "zustand/react/shallow";
import { listen } from "@tauri-apps/api/event";
import {
    X,
    Search,
    Palette,
    Sparkles,
    Keyboard,
    Code2,
    Sun,
    Moon,
    Key,
    Globe,
    RotateCcw,
    AlertTriangle,
    CheckCircle2,
    Loader2,
    ChevronRight,
    Type,
    ZoomIn,
    Save,
    Gem,
    Plus,
    Database,
    Trash2,
    Download,
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useUIStore, SettingsCategory, Theme } from "@/stores/uiStore";
import { useFileStore } from "@/stores/fileStore";
import {
    AIProviderPreset,
    AIProviderType,
    createProviderPreset,
    getDefaultModelsForProviderType,
    modelsMatchProviderDefaults,
    useSettingsStore,
    KeyBinding,
    LspInstallProvider,
    SidebarNavigationMode,
    ActivityBarAlignment,
} from "@/stores/settingsStore";
import { useLspExtensions } from "@/hooks/useLspExtensions";

interface SettingsCategoryItem {
    id: SettingsCategory;
    label: string;
    icon: React.ReactNode;
}

const CATEGORIES: SettingsCategoryItem[] = [
    { id: "appearance", label: "Appearance", icon: <Palette className="w-4 h-4" /> },
    { id: "ai", label: "AI Settings", icon: <Sparkles className="w-4 h-4" /> },
    { id: "keybindings", label: "Keybindings", icon: <Keyboard className="w-4 h-4" /> },
    { id: "editor", label: "Editor", icon: <Code2 className="w-4 h-4" /> },
    { id: "extensions", label: "LSP Extensions", icon: <Download className="w-4 h-4" /> },
];

const FONT_FAMILIES = [
    "JetBrains Mono",
    "Fira Code",
    "SF Mono",
    "Consolas",
    "Monaco",
    "Menlo",
    "Source Code Pro",
    "Ubuntu Mono",
];

interface PendingSettings {
    // Appearance
    theme?: Theme;
    editorFontSize?: number;
    editorFontFamily?: string;
    uiScale?: number;
    sidebarNavigationMode?: SidebarNavigationMode;
    activityBarAlignment?: ActivityBarAlignment;
    // AI
    providerType?: AIProviderType;
    openAIKey?: string;
    openAIBaseUrl?: string;
    aiModels?: { id: string; name: string; supportsImages: boolean }[];
    selectedModelId?: string;
    providerPresetsEnabled?: boolean;
    providerPresets?: AIProviderPreset[];
    selectedProviderPresetId?: string;
    inlineCompletionsEnabled?: boolean;
    chatContextWindow?: number;
    persistentWorkspaceIndexEnabled?: boolean;
    // Editor
    tabSize?: number;
    wordWrap?: boolean;
    lineNumbers?: boolean;
    minimap?: boolean;
    lspInstallProvider?: LspInstallProvider;
    // Keybindings
    keybindings?: KeyBinding[];
}

interface WorkspaceIndexStats {
    root_path: string;
    file_count: number;
    directory_count: number;
    ignored_rules: string[];
    last_indexed_at: number;
}

interface WorkspaceIndexCacheSummary {
    persistence_enabled: boolean;
    workspace_count: number;
    file_count: number;
    directory_count: number;
    total_size_bytes: number;
    last_indexed_at: number | null;
    cached_roots: WorkspaceIndexStats[];
}

interface ClearedWorkspaceIndexCache {
    workspace_count: number;
    entry_count: number;
}

export function SettingsPage() {
    const { isSettingsPageOpen, closeSettingsPage, settingsCategory, setSettingsCategory, theme, setTheme } = useUIStore(
        useShallow((state) => ({
            isSettingsPageOpen: state.isSettingsPageOpen,
            closeSettingsPage: state.closeSettingsPage,
            settingsCategory: state.settingsCategory,
            setSettingsCategory: state.setSettingsCategory,
            theme: state.theme,
            setTheme: state.setTheme,
        }))
    );
    const settings = useSettingsStore(
        useShallow((state) => ({
            providerType: state.providerType,
            openAIKey: state.openAIKey,
            openAIBaseUrl: state.openAIBaseUrl,
            aiModels: state.aiModels,
            selectedModelId: state.selectedModelId,
            providerPresetsEnabled: state.providerPresetsEnabled,
            providerPresets: state.providerPresets,
            selectedProviderPresetId: state.selectedProviderPresetId,
            inlineCompletionsEnabled: state.inlineCompletionsEnabled,
            chatContextWindow: state.chatContextWindow,
            persistentWorkspaceIndexEnabled: state.persistentWorkspaceIndexEnabled,
            editorFontSize: state.editorFontSize,
            editorFontFamily: state.editorFontFamily,
            uiScale: state.uiScale,
            sidebarNavigationMode: state.sidebarNavigationMode,
            activityBarAlignment: state.activityBarAlignment,
            tabSize: state.tabSize,
            wordWrap: state.wordWrap,
            lineNumbers: state.lineNumbers,
            minimap: state.minimap,
            lspInstallProvider: state.lspInstallProvider,
            keybindings: state.keybindings,
            setProviderType: state.setProviderType,
            setOpenAIKey: state.setOpenAIKey,
            setOpenAIBaseUrl: state.setOpenAIBaseUrl,
            setAIModels: state.setAIModels,
            setSelectedModelId: state.setSelectedModelId,
            setProviderPresetsEnabled: state.setProviderPresetsEnabled,
            setProviderPresets: state.setProviderPresets,
            setSelectedProviderPresetId: state.setSelectedProviderPresetId,
            setInlineCompletionsEnabled: state.setInlineCompletionsEnabled,
            setChatContextWindow: state.setChatContextWindow,
            setPersistentWorkspaceIndexEnabled: state.setPersistentWorkspaceIndexEnabled,
            setEditorFontSize: state.setEditorFontSize,
            setEditorFontFamily: state.setEditorFontFamily,
            setUIScale: state.setUIScale,
            setTabSize: state.setTabSize,
            setWordWrap: state.setWordWrap,
            setLineNumbers: state.setLineNumbers,
            setMinimap: state.setMinimap,
            setSidebarNavigationMode: state.setSidebarNavigationMode,
            setActivityBarAlignment: state.setActivityBarAlignment,
            setLspInstallProvider: state.setLspInstallProvider,
            updateKeybinding: state.updateKeybinding,
        }))
    );
    const {
        extensions,
        isLoading: isExtensionsLoading,
        installInFlightIds,
        installExtension,
        updateExtension,
        uninstallExtension,
        refreshExtensions,
    } = useLspExtensions();
    const rootPath = useFileStore((state) => state.rootPath);
    const [searchQuery, setSearchQuery] = useState("");
    const [pending, setPending] = useState<PendingSettings>({});
    const [hasChanges, setHasChanges] = useState(false);
    const [showSaved, setShowSaved] = useState(false);
    const [workspaceCacheSummary, setWorkspaceCacheSummary] = useState<WorkspaceIndexCacheSummary | null>(null);
    const [workspaceCacheError, setWorkspaceCacheError] = useState<string | null>(null);
    const [isWorkspaceCacheLoading, setIsWorkspaceCacheLoading] = useState(false);
    const [isClearingWorkspaceCache, setIsClearingWorkspaceCache] = useState(false);

    // Reset pending changes when opening
    useEffect(() => {
        if (isSettingsPageOpen) {
            setPending({});
            setHasChanges(false);
        }
    }, [isSettingsPageOpen]);

    useEffect(() => {
        if (!isSettingsPageOpen) {
            return;
        }

        let isActive = true;

        const loadWorkspaceCacheSummary = async () => {
            setIsWorkspaceCacheLoading(true);
            setWorkspaceCacheError(null);

            try {
                const summary = await invoke<WorkspaceIndexCacheSummary>("get_workspace_index_cache_summary");
                if (isActive) {
                    setWorkspaceCacheSummary(summary);
                }
            } catch (error) {
                if (isActive) {
                    setWorkspaceCacheError(String(error));
                }
            } finally {
                if (isActive) {
                    setIsWorkspaceCacheLoading(false);
                }
            }
        };

        loadWorkspaceCacheSummary();

        return () => {
            isActive = false;
        };
    }, [isSettingsPageOpen]);

    const updatePending = <K extends keyof PendingSettings>(key: K, value: PendingSettings[K]) => {
        setPending((prev) => ({ ...prev, [key]: value }));
        setHasChanges(true);
    };

    const getValue = <K extends keyof PendingSettings>(key: K, defaultValue: PendingSettings[K]): NonNullable<PendingSettings[K]> => {
        return (pending[key] ?? defaultValue) as NonNullable<PendingSettings[K]>;
    };

    const handleSave = () => {
        // Apply all pending changes
        if (pending.theme !== undefined) setTheme(pending.theme);
        if (pending.editorFontSize !== undefined) settings.setEditorFontSize(pending.editorFontSize);
        if (pending.editorFontFamily !== undefined) settings.setEditorFontFamily(pending.editorFontFamily);
        if (pending.uiScale !== undefined) settings.setUIScale(pending.uiScale);
        if (pending.sidebarNavigationMode !== undefined) settings.setSidebarNavigationMode(pending.sidebarNavigationMode);
        if (pending.activityBarAlignment !== undefined) settings.setActivityBarAlignment(pending.activityBarAlignment);
        if (pending.providerType !== undefined) settings.setProviderType(pending.providerType);
        if (pending.openAIKey !== undefined) settings.setOpenAIKey(pending.openAIKey);
        if (pending.openAIBaseUrl !== undefined) settings.setOpenAIBaseUrl(pending.openAIBaseUrl);
        if (pending.aiModels !== undefined) settings.setAIModels(pending.aiModels);
        if (pending.selectedModelId !== undefined) settings.setSelectedModelId(pending.selectedModelId);
        if (pending.providerPresetsEnabled !== undefined) settings.setProviderPresetsEnabled(pending.providerPresetsEnabled);
        if (pending.providerPresets !== undefined) settings.setProviderPresets(pending.providerPresets);
        if (pending.selectedProviderPresetId !== undefined) settings.setSelectedProviderPresetId(pending.selectedProviderPresetId);
        if (pending.inlineCompletionsEnabled !== undefined) settings.setInlineCompletionsEnabled(pending.inlineCompletionsEnabled);
        if (pending.chatContextWindow !== undefined) settings.setChatContextWindow(pending.chatContextWindow);
        if (pending.persistentWorkspaceIndexEnabled !== undefined) settings.setPersistentWorkspaceIndexEnabled(pending.persistentWorkspaceIndexEnabled);
        if (pending.tabSize !== undefined) settings.setTabSize(pending.tabSize);
        if (pending.wordWrap !== undefined) settings.setWordWrap(pending.wordWrap);
        if (pending.lineNumbers !== undefined) settings.setLineNumbers(pending.lineNumbers);
        if (pending.minimap !== undefined) settings.setMinimap(pending.minimap);
        if (pending.lspInstallProvider !== undefined) settings.setLspInstallProvider(pending.lspInstallProvider);
        if (pending.keybindings !== undefined) {
            pending.keybindings.forEach((kb) => {
                settings.updateKeybinding(kb.id, kb);
            });
        }

        setPending({});
        setHasChanges(false);
        setShowSaved(true);
        setTimeout(() => setShowSaved(false), 2000);
    };

    const handleCancel = () => {
        setPending({});
        setHasChanges(false);
        closeSettingsPage();
    };

    const handleClearWorkspaceCache = async () => {
        const confirmed = window.confirm(
            "Clear the persisted workspace cache? The next workspace open may rebuild the index."
        );
        if (!confirmed) {
            return;
        }

        setIsClearingWorkspaceCache(true);
        setWorkspaceCacheError(null);

        try {
            await invoke<ClearedWorkspaceIndexCache>("clear_workspace_index_cache");
            const summary = await invoke<WorkspaceIndexCacheSummary>("get_workspace_index_cache_summary");
            setWorkspaceCacheSummary(summary);
        } catch (error) {
            setWorkspaceCacheError(String(error));
        } finally {
            setIsClearingWorkspaceCache(false);
        }
    };

    if (!isSettingsPageOpen) return null;

    const filteredCategories = searchQuery
        ? CATEGORIES.filter((c) => c.label.toLowerCase().includes(searchQuery.toLowerCase()))
        : CATEGORIES;

    return (
        <div className="absolute inset-0 z-50 flex flex-col bg-[var(--color-surface-base)] animate-fade-in">
            {/* Top Bar with Save Button */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)]">
                <h1 className="text-base font-semibold text-[var(--color-text-primary)]">Settings</h1>
                <div className="flex items-center gap-3">
                    {showSaved && (
                        <span className="flex items-center gap-1.5 text-sm text-[var(--color-accent-success)]">
                            <CheckCircle2 className="w-4 h-4" />
                            Saved!
                        </span>
                    )}
                    {hasChanges && (
                        <span className="text-xs text-[var(--color-accent-warning)] bg-[var(--color-accent-warning)]/10 px-2 py-1 rounded">
                            Unsaved changes
                        </span>
                    )}
                    <button
                        onClick={handleCancel}
                        className="px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] rounded-lg transition-all"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={handleSave}
                        disabled={!hasChanges}
                        className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] rounded-lg hover:opacity-90 transition-all disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
                    >
                        <Save className="w-4 h-4" />
                        Save
                    </button>
                    <button
                        onClick={closeSettingsPage}
                        className="p-1.5 hover:bg-[var(--color-void-700)] rounded transition-colors text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)]"
                        title="Close (Esc)"
                    >
                        <X className="w-4 h-4" />
                    </button>
                </div>
            </div>

            <div className="flex flex-1 overflow-hidden">
                {/* Left Sidebar - Categories */}
                <div className="w-64 flex-shrink-0 border-r border-[var(--color-border-subtle)] bg-[var(--color-surface-elevated)] flex flex-col">
                    {/* Search */}
                    <div className="p-3 border-b border-[var(--color-border-subtle)]">
                        <div className="relative">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--color-text-muted)]" />
                            <input
                                type="text"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Search settings..."
                                className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg pl-10 pr-3 py-2 text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                            />
                        </div>
                    </div>

                    {/* Category List */}
                    <nav className="flex-1 overflow-y-auto p-2 space-y-1">
                        {filteredCategories.map((category) => (
                            <button
                                key={category.id}
                                onClick={() => setSettingsCategory(category.id)}
                                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                                    settingsCategory === category.id
                                        ? "bg-[var(--color-accent-primary)]/15 text-[var(--color-accent-primary)]"
                                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-void-700)] hover:text-[var(--color-text-primary)]"
                                }`}
                            >
                                <span className={settingsCategory === category.id ? "text-[var(--color-accent-primary)]" : "text-[var(--color-text-muted)]"}>
                                    {category.icon}
                                </span>
                                {category.label}
                                {settingsCategory === category.id && (
                                    <ChevronRight className="w-4 h-4 ml-auto" />
                                )}
                            </button>
                        ))}
                    </nav>

                    {/* Footer */}
                    <div className="p-3 border-t border-[var(--color-border-subtle)]">
                        <p className="text-[10px] text-[var(--color-text-muted)] uppercase tracking-wider text-center">
                            Press Esc to close
                        </p>
                    </div>
                </div>

                {/* Right Panel - Settings Content */}
                <div className="flex-1 overflow-y-auto">
                    <div className="max-w-3xl mx-auto p-8">
                        {settingsCategory === "appearance" && (
                            <AppearanceSettings
                                currentTheme={getValue("theme", theme)}
                                currentFontSize={getValue("editorFontSize", settings.editorFontSize)}
                                currentFontFamily={getValue("editorFontFamily", settings.editorFontFamily)}
                                currentUIScale={getValue("uiScale", settings.uiScale)}
                                currentSidebarNavigationMode={getValue("sidebarNavigationMode", settings.sidebarNavigationMode)}
                                currentActivityBarAlignment={getValue("activityBarAlignment", settings.activityBarAlignment)}
                                onThemeChange={(v) => updatePending("theme", v)}
                                onFontSizeChange={(v) => updatePending("editorFontSize", v)}
                                onFontFamilyChange={(v) => updatePending("editorFontFamily", v)}
                                onUIScaleChange={(v) => updatePending("uiScale", v)}
                                onSidebarNavigationModeChange={(v) => updatePending("sidebarNavigationMode", v)}
                                onActivityBarAlignmentChange={(v) => updatePending("activityBarAlignment", v)}
                            />
                        )}
                        {settingsCategory === "ai" && (
                            <AISettings
                                currentProviderType={getValue("providerType", settings.providerType)}
                                currentKey={getValue("openAIKey", settings.openAIKey)}
                                currentBaseUrl={getValue("openAIBaseUrl", settings.openAIBaseUrl)}
                                currentModels={getValue("aiModels", settings.aiModels)}
                                currentSelectedModelId={getValue("selectedModelId", settings.selectedModelId)}
                                currentProviderPresetsEnabled={getValue("providerPresetsEnabled", settings.providerPresetsEnabled)}
                                currentProviderPresets={getValue("providerPresets", settings.providerPresets)}
                                currentSelectedProviderPresetId={getValue("selectedProviderPresetId", settings.selectedProviderPresetId)}
                                currentInlineEnabled={getValue("inlineCompletionsEnabled", settings.inlineCompletionsEnabled)}
                                currentChatContextWindow={getValue("chatContextWindow", settings.chatContextWindow)}
                                onProviderTypeChange={(v) => updatePending("providerType", v)}
                                onKeyChange={(v) => updatePending("openAIKey", v)}
                                onBaseUrlChange={(v) => updatePending("openAIBaseUrl", v)}
                                onModelsChange={(v) => updatePending("aiModels", v)}
                                onSelectedModelIdChange={(v) => updatePending("selectedModelId", v)}
                                onProviderPresetsEnabledChange={(v) => updatePending("providerPresetsEnabled", v)}
                                onProviderPresetsChange={(v) => updatePending("providerPresets", v)}
                                onSelectedProviderPresetIdChange={(v) => updatePending("selectedProviderPresetId", v)}
                                onInlineEnabledChange={(v) => updatePending("inlineCompletionsEnabled", v)}
                                onChatContextWindowChange={(v) => updatePending("chatContextWindow", v)}
                            />
                        )}
                        {settingsCategory === "keybindings" && (
                            <KeybindingsSettings
                                keybindings={getValue("keybindings", settings.keybindings)}
                                onKeybindingsChange={(v) => updatePending("keybindings", v)}
                            />
                        )}
                        {settingsCategory === "editor" && (
                            <EditorSettings
                                currentTabSize={getValue("tabSize", settings.tabSize)}
                                currentWordWrap={getValue("wordWrap", settings.wordWrap)}
                                currentLineNumbers={getValue("lineNumbers", settings.lineNumbers)}
                                currentMinimap={getValue("minimap", settings.minimap)}
                                currentPersistentWorkspaceIndexEnabled={getValue("persistentWorkspaceIndexEnabled", settings.persistentWorkspaceIndexEnabled)}
                                workspaceRootPath={rootPath}
                                workspaceCacheSummary={workspaceCacheSummary}
                                workspaceCacheError={workspaceCacheError}
                                isWorkspaceCacheLoading={isWorkspaceCacheLoading}
                                isClearingWorkspaceCache={isClearingWorkspaceCache}
                                onTabSizeChange={(v) => updatePending("tabSize", v)}
                                onWordWrapChange={(v) => updatePending("wordWrap", v)}
                                onLineNumbersChange={(v) => updatePending("lineNumbers", v)}
                                onMinimapChange={(v) => updatePending("minimap", v)}
                                onPersistentWorkspaceIndexEnabledChange={(v) => updatePending("persistentWorkspaceIndexEnabled", v)}
                                onClearWorkspaceCache={handleClearWorkspaceCache}
                            />
                        )}
                        {settingsCategory === "extensions" && (
                            <ExtensionsSettings
                                currentInstallProvider={getValue("lspInstallProvider", settings.lspInstallProvider)}
                                extensions={extensions}
                                isLoading={isExtensionsLoading}
                                installInFlightIds={installInFlightIds}
                                onInstallProviderChange={(v) => updatePending("lspInstallProvider", v)}
                                onInstall={(id, provider) => installExtension(id, provider)}
                                onUpdate={(id, provider) => updateExtension(id, provider)}
                                onUninstall={(id) => uninstallExtension(id)}
                                onRefresh={refreshExtensions}
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function SettingSection({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="mb-8">
            <h2 className="text-lg font-semibold text-[var(--color-text-primary)] mb-1">{title}</h2>
            {description && <p className="text-sm text-[var(--color-text-muted)] mb-4">{description}</p>}
            <div className="space-y-4">{children}</div>
        </div>
    );
}

function SettingRow({ label, description, children }: { label: string; description?: string; children: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-8 py-3 border-b border-[var(--color-border-subtle)]">
            <div className="flex-1">
                <label className="text-sm font-medium text-[var(--color-text-primary)]">{label}</label>
                {description && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>}
            </div>
            <div className="flex-shrink-0">{children}</div>
        </div>
    );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (checked: boolean) => void }) {
    return (
        <button
            type="button"
            onClick={() => onChange(!checked)}
            className={`relative w-11 h-6 rounded-full transition-colors ${
                checked ? "bg-[var(--color-accent-primary)]" : "bg-[var(--color-void-600)]"
            }`}
        >
            <span
                className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${
                    checked ? "translate-x-5" : ""
                }`}
            />
        </button>
    );
}

function NumberInput({ value, onChange, min, max, step = 1 }: { value: number; onChange: (value: number) => void; min: number; max: number; step?: number }) {
    return (
        <input
            type="number"
            value={value}
            onChange={(e) => onChange(Number(e.target.value))}
            min={min}
            max={max}
            step={step}
            className="w-20 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-primary)] text-center focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
        />
    );
}

function SelectInput({ value, onChange, options }: { value: string; onChange: (value: string) => void; options: string[] }) {
    return (
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-1.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors cursor-pointer"
        >
            {options.map((opt) => (
                <option key={opt} value={opt}>
                    {opt}
                </option>
            ))}
        </select>
    );
}

interface AppearanceSettingsProps {
    currentTheme: Theme;
    currentFontSize: number;
    currentFontFamily: string;
    currentUIScale: number;
    currentSidebarNavigationMode: SidebarNavigationMode;
    currentActivityBarAlignment: ActivityBarAlignment;
    onThemeChange: (theme: Theme) => void;
    onFontSizeChange: (size: number) => void;
    onFontFamilyChange: (family: string) => void;
    onUIScaleChange: (scale: number) => void;
    onSidebarNavigationModeChange: (mode: SidebarNavigationMode) => void;
    onActivityBarAlignmentChange: (alignment: ActivityBarAlignment) => void;
}

function AppearanceSettings({
    currentTheme,
    currentFontSize,
    currentFontFamily,
    currentUIScale,
    currentSidebarNavigationMode,
    currentActivityBarAlignment,
    onThemeChange,
    onFontSizeChange,
    onFontFamilyChange,
    onUIScaleChange,
    onSidebarNavigationModeChange,
    onActivityBarAlignmentChange,
}: AppearanceSettingsProps) {
    return (
        <>
            <SettingSection title="Appearance" description="Customize the look and feel of VoiDesk">
                <SettingRow label="Theme" description="Choose your preferred color theme">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onThemeChange("obsidian")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentTheme === "obsidian"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            }`}
                        >
                            <Gem className="w-4 h-4" />
                            Obsidian
                        </button>
                        <button
                            onClick={() => onThemeChange("dark")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentTheme === "dark"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            }`}
                        >
                            <Moon className="w-4 h-4" />
                            Dark
                        </button>
                        <button
                            onClick={() => onThemeChange("light")}
                            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentTheme === "light"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                            }`}
                        >
                            <Sun className="w-4 h-4" />
                            Light
                        </button>
                    </div>
                </SettingRow>

                <SettingRow label="Editor Font Size" description="Font size in the code editor (10-32px)">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onFontSizeChange(currentFontSize - 1)}
                            className="w-8 h-8 flex items-center justify-center rounded bg-[var(--color-void-700)] hover:bg-[var(--color-void-600)] text-[var(--color-text-secondary)]"
                        >
                            -
                        </button>
                        <NumberInput value={currentFontSize} onChange={onFontSizeChange} min={10} max={32} />
                        <button
                            onClick={() => onFontSizeChange(currentFontSize + 1)}
                            className="w-8 h-8 flex items-center justify-center rounded bg-[var(--color-void-700)] hover:bg-[var(--color-void-600)] text-[var(--color-text-secondary)]"
                        >
                            +
                        </button>
                        <Type className="w-4 h-4 text-[var(--color-text-muted)] ml-2" />
                    </div>
                </SettingRow>

                <SettingRow label="Editor Font Family" description="Choose the monospace font for the editor">
                    <SelectInput value={currentFontFamily} onChange={onFontFamilyChange} options={FONT_FAMILIES} />
                </SettingRow>

                <SettingRow label="UI Scale" description="Scale the entire interface (75-150%)">
                    <div className="flex items-center gap-2">
                        <input
                            type="range"
                            min={75}
                            max={150}
                            step={5}
                            value={currentUIScale}
                            onChange={(e) => onUIScaleChange(Number(e.target.value))}
                            className="w-32 accent-[var(--color-accent-primary)]"
                        />
                        <span className="text-sm text-[var(--color-text-secondary)] w-12">{currentUIScale}%</span>
                        <ZoomIn className="w-4 h-4 text-[var(--color-text-muted)]" />
                    </div>
                </SettingRow>

                <SettingRow label="Sidebar Navigation Layout" description="Switch between the current integrated strip and a VS Code-style activity bar.">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onSidebarNavigationModeChange("integrated")}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentSidebarNavigationMode === "integrated"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)]"
                            }`}
                        >
                            Integrated
                        </button>
                        <button
                            onClick={() => onSidebarNavigationModeChange("activity_bar")}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentSidebarNavigationMode === "activity_bar"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)]"
                            }`}
                        >
                            Activity Bar
                        </button>
                    </div>
                </SettingRow>

                <SettingRow label="Navigation Alignment" description="Choose whether the sidebar navigation icons sit near the top or lower down.">
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => onActivityBarAlignmentChange("top")}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentActivityBarAlignment === "top"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)]"
                            }`}
                        >
                            Top
                        </button>
                        <button
                            onClick={() => onActivityBarAlignmentChange("bottom")}
                            className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                                currentActivityBarAlignment === "bottom"
                                    ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                    : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)]"
                            }`}
                        >
                            Bottom
                        </button>
                    </div>
                </SettingRow>
            </SettingSection>
        </>
    );
}

interface AISettingsProps {
    currentProviderType: AIProviderType;
    currentKey: string;
    currentBaseUrl: string;
    currentModels: { id: string; name: string; supportsImages: boolean }[];
    currentSelectedModelId: string;
    currentProviderPresetsEnabled: boolean;
    currentProviderPresets: AIProviderPreset[];
    currentSelectedProviderPresetId: string;
    currentInlineEnabled: boolean;
    currentChatContextWindow: number;
    onProviderTypeChange: (providerType: AIProviderType) => void;
    onKeyChange: (key: string) => void;
    onBaseUrlChange: (url: string) => void;
    onModelsChange: (models: { id: string; name: string; supportsImages: boolean }[]) => void;
    onSelectedModelIdChange: (id: string) => void;
    onProviderPresetsEnabledChange: (enabled: boolean) => void;
    onProviderPresetsChange: (presets: AIProviderPreset[]) => void;
    onSelectedProviderPresetIdChange: (id: string) => void;
    onInlineEnabledChange: (enabled: boolean) => void;
    onChatContextWindowChange: (tokens: number) => void;
}

interface CodexAuthStatus {
    authenticated: boolean;
    account_id?: string | null;
    expires_at_ms?: number | null;
    login_in_progress: boolean;
}

const OPENAI_COMPATIBLE_BASE_URL = "https://api.openai.com";
const CODEX_BASE_URL = "https://chatgpt.com/backend-api";

const providerOptions: { value: AIProviderType; label: string }[] = [
    { value: "openai_compatible", label: "OpenAI Compatible" },
    { value: "codex_subscription", label: "ChatGPT OAuth (Codex)" },
];

const modelsMatchExact = (
    models: { id: string; name: string; supportsImages: boolean }[],
    defaults: { id: string; name: string; supportsImages: boolean }[]
) =>
    models.length === defaults.length
    && models.every((model, index) =>
        model.id === defaults[index]?.id
        && model.name === defaults[index]?.name
        && model.supportsImages === defaults[index]?.supportsImages
    );

const resolveModelsForProviderSwitch = (
    models: { id: string; name: string; supportsImages: boolean }[],
    currentProviderType: AIProviderType,
    nextProviderType: AIProviderType
) => {
    const emptyModels = models.length === 0 || models.every((model) => !model.id.trim() && !model.name.trim());

    if (
        currentProviderType !== nextProviderType
        || emptyModels
        || modelsMatchExact(models, getDefaultModelsForProviderType("openai_compatible"))
        || modelsMatchExact(models, getDefaultModelsForProviderType("codex_subscription"))
        || modelsMatchProviderDefaults(models, currentProviderType)
        || modelsMatchProviderDefaults(models, nextProviderType)
    ) {
        return getDefaultModelsForProviderType(nextProviderType);
    }

    return models;
};

function AISettings({
    currentProviderType,
    currentKey,
    currentBaseUrl,
    currentModels,
    currentSelectedModelId,
    currentProviderPresetsEnabled,
    currentProviderPresets,
    currentSelectedProviderPresetId,
    currentInlineEnabled,
    currentChatContextWindow,
    onProviderTypeChange,
    onKeyChange,
    onBaseUrlChange,
    onModelsChange,
    onSelectedModelIdChange,
    onProviderPresetsEnabledChange,
    onProviderPresetsChange,
    onSelectedProviderPresetIdChange,
    onInlineEnabledChange,
    onChatContextWindowChange,
}: AISettingsProps) {
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);
    const [codexAuthStatus, setCodexAuthStatus] = useState<CodexAuthStatus | null>(null);
    const [isAuthBusy, setIsAuthBusy] = useState(false);

    const normalizedPresets = currentProviderPresets.length > 0 ? currentProviderPresets : [createProviderPreset()];
    const activePreset =
        normalizedPresets.find((preset) => preset.id === currentSelectedProviderPresetId) || normalizedPresets[0];
    const presetModels = activePreset?.models?.length ? activePreset.models : [{ id: "", name: "", supportsImages: false }];
    const selectedModel = currentProviderPresetsEnabled
        ? presetModels.find((model) => model.id === activePreset?.selectedModelId) || presetModels[0]
        : currentModels.find((model) => model.id === currentSelectedModelId) || currentModels[0];
    const selectedModelId = selectedModel?.id || "";
    const activeProviderType = currentProviderPresetsEnabled
        ? activePreset?.providerType || "openai_compatible"
        : currentProviderType;
    const isCodexActive = activeProviderType === "codex_subscription";
    const activeApiKey = currentProviderPresetsEnabled ? activePreset?.apiKey || "" : currentKey;
    const activeBaseUrl = currentProviderPresetsEnabled ? activePreset?.baseUrl || currentBaseUrl : currentBaseUrl;

    const refreshCodexAuthStatus = async () => {
        try {
            const status = await invoke<CodexAuthStatus>("codex_auth_status");
            setCodexAuthStatus(status);
        } catch (error) {
            setCodexAuthStatus({
                authenticated: false,
                login_in_progress: false,
            });
            setTestResult({ success: false, message: String(error) });
        }
    };

    useEffect(() => {
        refreshCodexAuthStatus();

        let disposed = false;
        const unlisteners: Array<() => void> = [];

        const bindListeners = async () => {
            const created = await Promise.all([
                listen("codex-auth://success", (event) => {
                    if (disposed) return;
                    setCodexAuthStatus(event.payload as CodexAuthStatus);
                    setTestResult(null);
                    setIsAuthBusy(false);
                }),
                listen("codex-auth://error", (event) => {
                    if (disposed) return;
                    setIsAuthBusy(false);
                    setTestResult({ success: false, message: String(event.payload) });
                    refreshCodexAuthStatus();
                }),
                listen("codex-auth://logged-out", () => {
                    if (disposed) return;
                    setIsAuthBusy(false);
                    setCodexAuthStatus({
                        authenticated: false,
                        login_in_progress: false,
                    });
                }),
                listen("codex-auth://started", () => {
                    if (disposed) return;
                    setIsAuthBusy(false);
                    setCodexAuthStatus((previous) => ({
                        authenticated: previous?.authenticated ?? false,
                        account_id: previous?.account_id ?? null,
                        expires_at_ms: previous?.expires_at_ms ?? null,
                        login_in_progress: true,
                    }));
                }),
            ]);
            unlisteners.push(...created);
        };

        bindListeners();

        return () => {
            disposed = true;
            unlisteners.forEach((unlisten) => unlisten());
        };
    }, []);

    const applyProviderPresets = (presets: AIProviderPreset[]) => {
        const normalized = presets.length > 0 ? presets : [createProviderPreset()];
        onProviderPresetsChange(normalized);

        const nextSelectedPresetId = normalized.some((preset) => preset.id === currentSelectedProviderPresetId)
            ? currentSelectedProviderPresetId
            : normalized[0]?.id || "";
        onSelectedProviderPresetIdChange(nextSelectedPresetId);
    };

    const updatePreset = (presetId: string, updates: Partial<AIProviderPreset>) => {
        applyProviderPresets(
            normalizedPresets.map((preset) => {
                if (preset.id !== presetId) {
                    return preset;
                }

                const nextProviderType = updates.providerType ?? preset.providerType;
                const nextModels = updates.models ?? preset.models;
                const nextSelectedModelId =
                    updates.selectedModelId && nextModels.some((model) => model.id === updates.selectedModelId)
                        ? updates.selectedModelId
                        : nextModels.some((model) => model.id === preset.selectedModelId)
                            ? preset.selectedModelId
                            : nextModels[0]?.id || "";

                return {
                    ...preset,
                    ...updates,
                    providerType: nextProviderType,
                    models: nextModels,
                    selectedModelId: nextSelectedModelId,
                };
            })
        );
    };

    const handleProviderTypeChange = (nextProviderType: AIProviderType) => {
        const nextModels = resolveModelsForProviderSwitch(currentModels, currentProviderType, nextProviderType);
        onProviderTypeChange(nextProviderType);
        onModelsChange(nextModels);
        onSelectedModelIdChange(nextModels[0]?.id || "");
        onBaseUrlChange(nextProviderType === "codex_subscription" ? CODEX_BASE_URL : OPENAI_COMPATIBLE_BASE_URL);
    };

    const handlePresetProviderTypeChange = (preset: AIProviderPreset, nextProviderType: AIProviderType) => {
        const nextModels = resolveModelsForProviderSwitch(preset.models, preset.providerType, nextProviderType);
        updatePreset(preset.id, {
            providerType: nextProviderType,
            baseUrl: nextProviderType === "codex_subscription" ? CODEX_BASE_URL : OPENAI_COMPATIBLE_BASE_URL,
            models: nextModels,
            selectedModelId: nextModels[0]?.id || "",
        });
    };

    const handleCodexLogin = async () => {
        setIsAuthBusy(true);
        setTestResult(null);
        try {
            await invoke("codex_start_login");
        } catch (error) {
            setIsAuthBusy(false);
            setTestResult({ success: false, message: String(error) });
        }
    };

    const handleCodexLogout = async () => {
        setIsAuthBusy(true);
        try {
            await invoke("codex_logout");
            await refreshCodexAuthStatus();
        } catch (error) {
            setTestResult({ success: false, message: String(error) });
        } finally {
            setIsAuthBusy(false);
        }
    };

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await invoke<string>("test_ai_connection", {
                providerType: activeProviderType,
                apiKey: activeApiKey,
                baseUrl: activeBaseUrl,
                modelId: selectedModelId,
            });
            setTestResult({ success: true, message: result });
        } catch (error) {
            setTestResult({ success: false, message: String(error) });
        } finally {
            setIsTesting(false);
        }
    };

    return (
        <>
            <SettingSection title="AI Settings" description="Configure your AI assistant and inline completions">
                <div className="space-y-4">
                    <SettingRow
                        label="Provider Presets"
                        description="Turn this on to manage multiple provider groups, each with its own base URL and model list."
                    >
                        <Toggle
                            checked={currentProviderPresetsEnabled}
                            onChange={(enabled) => {
                                onProviderPresetsEnabledChange(enabled);
                                if (enabled) {
                                    if (currentProviderPresets.length === 0) {
                                        const migratedPreset = createProviderPreset({
                                            id: "default-provider",
                                            name: "Default Provider",
                                            providerType: currentProviderType,
                                            apiKey: currentKey,
                                            baseUrl: currentBaseUrl,
                                            models: currentModels,
                                            selectedModelId: currentSelectedModelId,
                                        });
                                        onProviderPresetsChange([migratedPreset]);
                                        onSelectedProviderPresetIdChange(migratedPreset.id);
                                    } else if (currentKey && currentProviderPresets.every((preset) => !preset.apiKey)) {
                                        onProviderPresetsChange(
                                            currentProviderPresets.map((preset, index) =>
                                                index === 0 ? { ...preset, apiKey: currentKey } : preset
                                            )
                                        );
                                    }
                                }
                            }}
                        />
                    </SettingRow>

                    {!currentProviderPresetsEnabled ? (
                        <>
                            <SettingRow label="Provider Type" description="Choose between API-key auth and your ChatGPT Codex subscription.">
                                <select
                                    value={currentProviderType}
                                    onChange={(e) => handleProviderTypeChange(e.target.value as AIProviderType)}
                                    className="min-w-64 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)]"
                                >
                                    {providerOptions.map((option) => (
                                        <option key={option.value} value={option.value}>
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </SettingRow>

                            {currentProviderType === "openai_compatible" ? (
                                <>
                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                            <Key className="w-4 h-4 text-[var(--color-text-muted)]" />
                                            OpenAI API Key
                                        </label>
                                        <input
                                            type="password"
                                            value={currentKey}
                                            onChange={(e) => onKeyChange(e.target.value)}
                                            placeholder="sk-..."
                                            className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                        />
                                        <p className="text-xs text-[var(--color-text-muted)]">Your API key is stored locally on this machine.</p>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                            <Globe className="w-4 h-4 text-[var(--color-text-muted)]" />
                                            Base URL
                                        </label>
                                        <input
                                            type="text"
                                            value={currentBaseUrl}
                                            onChange={(e) => onBaseUrlChange(e.target.value)}
                                            placeholder="https://api.openai.com"
                                            className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                        />
                                        <p className="text-xs text-[var(--color-text-muted)]">Change this if you use an OpenAI-compatible provider (e.g., OpenRouter).</p>
                                    </div>
                                </>
                            ) : (
                                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-void-850)] p-4 space-y-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div>
                                            <p className="text-sm font-medium text-[var(--color-text-primary)]">ChatGPT OAuth</p>
                                            <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                                Sign in with your ChatGPT account to use your Codex subscription inside VoiDesk.
                                            </p>
                                        </div>
                                        <button
                                            onClick={codexAuthStatus?.authenticated ? handleCodexLogout : handleCodexLogin}
                                            disabled={isAuthBusy || codexAuthStatus?.login_in_progress}
                                            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                        >
                                            {(isAuthBusy || codexAuthStatus?.login_in_progress) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                            {codexAuthStatus?.authenticated ? "Log Out" : "Sign in with ChatGPT"}
                                        </button>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
                                        <div className="rounded-lg bg-[var(--color-void-800)] px-3 py-2">
                                            <span className="text-[var(--color-text-muted)]">Status</span>
                                            <p className="mt-1 text-[var(--color-text-primary)]">
                                                {codexAuthStatus?.authenticated ? "Authenticated" : codexAuthStatus?.login_in_progress ? "Waiting for browser login" : "Not signed in"}
                                            </p>
                                        </div>
                                        <div className="rounded-lg bg-[var(--color-void-800)] px-3 py-2">
                                            <span className="text-[var(--color-text-muted)]">Account</span>
                                            <p className="mt-1 text-[var(--color-text-primary)] break-all">{codexAuthStatus?.account_id || "Unavailable"}</p>
                                        </div>
                                    </div>
                                </div>
                            )}

                            <div className="space-y-2">
                                <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                    <Sparkles className="w-4 h-4 text-[var(--color-text-muted)]" />
                                    Models
                                </label>
                                <div className="space-y-3">
                                    {currentModels.map((model, index) => (
                                        <div key={`${model.id}-${index}`} className="grid grid-cols-2 gap-3">
                                            <input
                                                type="text"
                                                value={model.name}
                                                onChange={(e) =>
                                                    onModelsChange(
                                                        currentModels.map((item, idx) =>
                                                            idx === index ? { ...item, name: e.target.value } : item
                                                        )
                                                    )
                                                }
                                                placeholder="Display name"
                                                className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                            />
                                            <div className="flex items-center gap-2">
                                                <input
                                                    type="text"
                                                    value={model.id}
                                                    onChange={(e) =>
                                                        onModelsChange(
                                                            currentModels.map((item, idx) =>
                                                                idx === index ? { ...item, id: e.target.value } : item
                                                            )
                                                        )
                                                    }
                                                    placeholder="Model ID"
                                                    className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                                />
                                                <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer whitespace-nowrap" title="Model supports image input">
                                                    <input
                                                        type="checkbox"
                                                        checked={model.supportsImages}
                                                        onChange={(e) =>
                                                            onModelsChange(
                                                                currentModels.map((item, idx) =>
                                                                    idx === index ? { ...item, supportsImages: e.target.checked } : item
                                                                )
                                                            )
                                                        }
                                                        className="w-3.5 h-3.5 rounded border-gray-600 bg-transparent accent-emerald-500"
                                                    />
                                                    Vision
                                                </label>
                                                {currentModels.length > 1 && (
                                                    <button
                                                        onClick={() => onModelsChange(currentModels.filter((_, idx) => idx !== index))}
                                                        className="p-2 text-[var(--color-text-muted)] hover:text-red-400"
                                                        title="Remove model"
                                                    >
                                                        <X className="w-4 h-4" />
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => onModelsChange([...currentModels, { id: "", name: "", supportsImages: false }])}
                                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] transition-all"
                                    >
                                        <Plus className="w-3.5 h-3.5" />
                                        Add Model
                                    </button>
                                </div>
                                <p className="text-xs text-[var(--color-text-muted)]">Add multiple models with a display name and model ID.</p>
                            </div>

                            <SettingRow label="Default Model" description="Select the model used in the chat panel.">
                                <select
                                    value={currentSelectedModelId}
                                    onChange={(e) => onSelectedModelIdChange(e.target.value)}
                                    className="bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)]"
                                >
                                    {currentModels.map((model, index) => (
                                        <option key={`${model.id}-${index}`} value={model.id}>
                                            {model.name || model.id || "Unnamed model"}
                                        </option>
                                    ))}
                                </select>
                            </SettingRow>
                        </>
                    ) : (
                        <>
                            <SettingRow label="Active Preset" description="This preset is selected first in the chat composer.">
                                <select
                                    value={activePreset?.id || ""}
                                    onChange={(e) => onSelectedProviderPresetIdChange(e.target.value)}
                                    className="min-w-56 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)]"
                                >
                                    {normalizedPresets.map((preset) => (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.name || "Unnamed preset"}
                                        </option>
                                    ))}
                                </select>
                            </SettingRow>

                            <div className="space-y-4">
                                {normalizedPresets.map((preset, presetIndex) => (
                                    <div key={preset.id} className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-void-850)] p-4 space-y-4">
                                        <div className="flex items-center justify-between gap-3">
                                            <div className="flex-1">
                                                <label className="text-xs uppercase tracking-widest text-[var(--color-text-muted)]">
                                                    Preset Name
                                                </label>
                                                <input
                                                    type="text"
                                                    value={preset.name}
                                                    onChange={(e) => updatePreset(preset.id, { name: e.target.value })}
                                                    placeholder={`Preset ${presetIndex + 1}`}
                                                    className="mt-1 w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                                />
                                            </div>
                                            {normalizedPresets.length > 1 && (
                                                <button
                                                    onClick={() => applyProviderPresets(normalizedPresets.filter((item) => item.id !== preset.id))}
                                                    className="p-2 text-[var(--color-text-muted)] hover:text-red-400"
                                                    title="Remove preset"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            )}
                                        </div>

                                        <SettingRow label="Provider Type" description="Select how this preset authenticates.">
                                            <select
                                                value={preset.providerType}
                                                onChange={(e) => handlePresetProviderTypeChange(preset, e.target.value as AIProviderType)}
                                                className="min-w-64 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)]"
                                            >
                                                {providerOptions.map((option) => (
                                                    <option key={option.value} value={option.value}>
                                                        {option.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </SettingRow>

                                        {preset.providerType === "openai_compatible" ? (
                                            <>
                                                <div className="space-y-2">
                                                    <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                                        <Key className="w-4 h-4 text-[var(--color-text-muted)]" />
                                                        API Key
                                                    </label>
                                                    <input
                                                        type="password"
                                                        value={preset.apiKey}
                                                        onChange={(e) => updatePreset(preset.id, { apiKey: e.target.value })}
                                                        placeholder="sk-..."
                                                        className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                                    />
                                                </div>

                                                <div className="space-y-2">
                                                    <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                                        <Globe className="w-4 h-4 text-[var(--color-text-muted)]" />
                                                        Base URL
                                                    </label>
                                                    <input
                                                        type="text"
                                                        value={preset.baseUrl}
                                                        onChange={(e) => updatePreset(preset.id, { baseUrl: e.target.value })}
                                                        placeholder="https://api.openai.com"
                                                        className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] p-3 space-y-3">
                                                <div className="flex items-center justify-between gap-3">
                                                    <div>
                                                        <p className="text-sm font-medium text-[var(--color-text-primary)]">ChatGPT OAuth</p>
                                                        <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                                            Shared app login used by all Codex presets.
                                                        </p>
                                                    </div>
                                                    <button
                                                        onClick={codexAuthStatus?.authenticated ? handleCodexLogout : handleCodexLogin}
                                                        disabled={isAuthBusy || codexAuthStatus?.login_in_progress}
                                                        className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                                                    >
                                                        {(isAuthBusy || codexAuthStatus?.login_in_progress) && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                                                        {codexAuthStatus?.authenticated ? "Log Out" : "Sign in with ChatGPT"}
                                                    </button>
                                                </div>
                                                <div className="text-xs text-[var(--color-text-secondary)]">
                                                    {codexAuthStatus?.authenticated
                                                        ? `Authenticated as ${codexAuthStatus.account_id || "unknown account"}`
                                                        : codexAuthStatus?.login_in_progress
                                                            ? "Waiting for browser login to complete."
                                                            : "Not authenticated yet."}
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-2">
                                            <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                                                <Sparkles className="w-4 h-4 text-[var(--color-text-muted)]" />
                                                Models
                                            </label>
                                            <div className="space-y-3">
                                                {preset.models.map((model, index) => (
                                                    <div key={`${preset.id}-${model.id}-${index}`} className="grid grid-cols-2 gap-3">
                                                        <input
                                                            type="text"
                                                            value={model.name}
                                                            onChange={(e) =>
                                                                updatePreset(preset.id, {
                                                                    models: preset.models.map((item, idx) =>
                                                                        idx === index ? { ...item, name: e.target.value } : item
                                                                    ),
                                                                })
                                                            }
                                                            placeholder="Display name"
                                                            className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                                        />
                                                        <div className="flex items-center gap-2">
                                                            <input
                                                                type="text"
                                                                value={model.id}
                                                                onChange={(e) =>
                                                                    updatePreset(preset.id, {
                                                                        models: preset.models.map((item, idx) =>
                                                                            idx === index ? { ...item, id: e.target.value } : item
                                                                        ),
                                                                    })
                                                                }
                                                                placeholder="Model ID"
                                                                className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                                                            />
                                                            <label className="flex items-center gap-1.5 text-[10px] text-gray-400 cursor-pointer whitespace-nowrap" title="Model supports image input">
                                                                <input
                                                                    type="checkbox"
                                                                    checked={model.supportsImages}
                                                                    onChange={(e) =>
                                                                        updatePreset(preset.id, {
                                                                            models: preset.models.map((item, idx) =>
                                                                                idx === index ? { ...item, supportsImages: e.target.checked } : item
                                                                            ),
                                                                        })
                                                                    }
                                                                    className="w-3.5 h-3.5 rounded border-gray-600 bg-transparent accent-emerald-500"
                                                                />
                                                                Vision
                                                            </label>
                                                            {preset.models.length > 1 && (
                                                                <button
                                                                    onClick={() =>
                                                                        updatePreset(preset.id, {
                                                                            models: preset.models.filter((_, idx) => idx !== index),
                                                                        })
                                                                    }
                                                                    className="p-2 text-[var(--color-text-muted)] hover:text-red-400"
                                                                    title="Remove model"
                                                                >
                                                                    <X className="w-4 h-4" />
                                                                </button>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={() =>
                                                        updatePreset(preset.id, {
                                                            models: [...preset.models, { id: "", name: "", supportsImages: false }],
                                                        })
                                                    }
                                                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] transition-all"
                                                >
                                                    <Plus className="w-3.5 h-3.5" />
                                                    Add Model
                                                </button>
                                            </div>
                                        </div>

                                        <SettingRow label="Default Model" description="Used when this preset is selected in chat.">
                                            <select
                                                value={preset.selectedModelId}
                                                onChange={(e) => updatePreset(preset.id, { selectedModelId: e.target.value })}
                                                className="min-w-56 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)]"
                                            >
                                                {preset.models.map((model, index) => (
                                                    <option key={`${preset.id}-${model.id}-${index}`} value={model.id}>
                                                        {model.name || model.id || "Unnamed model"}
                                                    </option>
                                                ))}
                                            </select>
                                        </SettingRow>
                                    </div>
                                ))}
                                <button
                                    onClick={() => applyProviderPresets([...normalizedPresets, createProviderPreset({ name: `Preset ${normalizedPresets.length + 1}` })])}
                                    className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] transition-all"
                                >
                                    <Plus className="w-3.5 h-3.5" />
                                    Add Preset
                                </button>
                            </div>
                        </>
                    )}

                    <SettingRow label="Inline AI Completions" description="Show AI-powered ghost text suggestions as you type. Press Tab to accept.">
                        <Toggle checked={currentInlineEnabled} onChange={onInlineEnabledChange} />
                    </SettingRow>

                    <SettingRow
                        label="Conversation Context Window"
                        description="Approximate token budget for prior chat history sent with each request. Older turns naturally fall out once this limit is reached."
                    >
                        <div className="flex items-center gap-2">
                            <input
                                type="number"
                                min={1024}
                                max={256000}
                                step={1024}
                                value={currentChatContextWindow}
                                onChange={(e) => onChatContextWindowChange(Math.max(1024, Number(e.target.value) || 1024))}
                                className="w-36 bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-3 py-2 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)]"
                            />
                            <span className="text-xs text-[var(--color-text-muted)]">tokens</span>
                        </div>
                    </SettingRow>

                    {/* Test Connection Button */}
                    <div className="flex items-center gap-3 pt-4">
                        <button
                            onClick={handleTest}
                            disabled={isTesting || (isCodexActive ? !codexAuthStatus?.authenticated : !activeApiKey)}
                            className="flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-600)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isTesting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Test Connection"}
                        </button>
                    </div>

                    {/* Test Result */}
                    {testResult && (
                        <div
                            className={`flex items-start gap-3 p-4 rounded-lg ${
                                testResult.success ? "bg-[var(--color-accent-success)]/10 border border-[var(--color-accent-success)]/30" : "bg-[var(--color-accent-error)]/10 border border-[var(--color-accent-error)]/30"
                            }`}
                        >
                            {testResult.success ? (
                                <CheckCircle2 className="w-5 h-5 text-[var(--color-accent-success)] flex-shrink-0 mt-0.5" />
                            ) : (
                                <AlertTriangle className="w-5 h-5 text-[var(--color-accent-error)] flex-shrink-0 mt-0.5" />
                            )}
                            <div>
                                <p className={`text-sm font-medium ${testResult.success ? "text-[var(--color-accent-success)]" : "text-[var(--color-accent-error)]"}`}>
                                    {testResult.success ? "Connection Successful" : "Connection Failed"}
                                </p>
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">{testResult.message}</p>
                            </div>
                        </div>
                    )}
                </div>
            </SettingSection>
        </>
    );
}

interface KeybindingsSettingsProps {
    keybindings: KeyBinding[];
    onKeybindingsChange: (keybindings: KeyBinding[]) => void;
}

function KeybindingsSettings({ keybindings, onKeybindingsChange }: KeybindingsSettingsProps) {
    const { resetKeybindings, getKeybindingConflicts } = useSettingsStore(
        useShallow((state) => ({
            resetKeybindings: state.resetKeybindings,
            getKeybindingConflicts: state.getKeybindingConflicts,
        }))
    );
    const [editingId, setEditingId] = useState<string | null>(null);
    const [pendingKeys, setPendingKeys] = useState<{ key: string; ctrl: boolean; shift: boolean; alt: boolean } | null>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    const conflicts = useMemo(() => getKeybindingConflicts(), [keybindings]);

    const handleKeyDown = (e: React.KeyboardEvent, bindingId: string) => {
        e.preventDefault();
        e.stopPropagation();

        if (e.key === "Escape") {
            setEditingId(null);
            setPendingKeys(null);
            return;
        }

        if (e.key === "Enter" && pendingKeys) {
            const updated = keybindings.map((kb) =>
                kb.id === bindingId ? { ...kb, ...pendingKeys } : kb
            );
            onKeybindingsChange(updated);
            setEditingId(null);
            setPendingKeys(null);
            return;
        }

        const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;

        setPendingKeys({
            key,
            ctrl: e.ctrlKey || e.metaKey,
            shift: e.shiftKey,
            alt: e.altKey,
        });
    };

    const formatKeybinding = (kb: KeyBinding | { key: string; ctrl?: boolean; shift?: boolean; alt?: boolean }) => {
        const parts: string[] = [];
        if (kb.ctrl) parts.push("Ctrl");
        if (kb.shift) parts.push("Shift");
        if (kb.alt) parts.push("Alt");
        parts.push(kb.key.length === 1 ? kb.key.toUpperCase() : kb.key);
        return parts.join(" + ");
    };

    const hasConflict = (bindingId: string) => {
        return conflicts.some((c) => c.id1 === bindingId || c.id2 === bindingId);
    };

    const handleReset = () => {
        resetKeybindings();
        onKeybindingsChange(useSettingsStore.getState().keybindings);
    };

    useEffect(() => {
        if (editingId && inputRef.current) {
            inputRef.current.focus();
        }
    }, [editingId]);

    return (
        <>
            <SettingSection title="Keyboard Shortcuts" description="Customize keyboard shortcuts for common actions">
                <div className="flex justify-end mb-4">
                    <button
                        onClick={handleReset}
                        className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-void-700)] transition-all"
                    >
                        <RotateCcw className="w-3 h-3" />
                        Reset to Defaults
                    </button>
                </div>

                {conflicts.length > 0 && (
                    <div className="mb-4 p-3 rounded-lg bg-[var(--color-accent-warning)]/10 border border-[var(--color-accent-warning)]/30">
                        <div className="flex items-center gap-2 text-[var(--color-accent-warning)]">
                            <AlertTriangle className="w-4 h-4" />
                            <span className="text-sm font-medium">Conflicting shortcuts detected</span>
                        </div>
                        <ul className="mt-2 text-xs text-[var(--color-text-muted)] list-disc list-inside">
                            {conflicts.map((c, i) => (
                                <li key={i}>{c.key} is used by multiple shortcuts</li>
                            ))}
                        </ul>
                    </div>
                )}

                <div className="space-y-1 rounded-lg border border-[var(--color-border-subtle)] overflow-hidden">
                    {keybindings.map((binding) => (
                        <div
                            key={binding.id}
                            className={`flex items-center justify-between px-4 py-3 bg-[var(--color-void-850)] border-b border-[var(--color-border-subtle)] last:border-b-0 ${
                                hasConflict(binding.id) ? "bg-[var(--color-accent-warning)]/5" : ""
                            }`}
                        >
                            <div className="flex items-center gap-3">
                                <Keyboard className="w-4 h-4 text-[var(--color-text-muted)]" />
                                <span className="text-sm text-[var(--color-text-primary)]">{binding.name}</span>
                                {hasConflict(binding.id) && <AlertTriangle className="w-4 h-4 text-[var(--color-accent-warning)]" />}
                            </div>
                            <div className="flex items-center gap-2">
                                {editingId === binding.id ? (
                                    <div className="flex items-center gap-2">
                                        <input
                                            ref={inputRef}
                                            type="text"
                                            readOnly
                                            value={pendingKeys ? formatKeybinding(pendingKeys) : "Press keys..."}
                                            onKeyDown={(e) => handleKeyDown(e, binding.id)}
                                            onBlur={() => {
                                                setEditingId(null);
                                                setPendingKeys(null);
                                            }}
                                            className="w-40 px-3 py-1.5 text-sm text-center bg-[var(--color-accent-primary)]/20 border border-[var(--color-accent-primary)] rounded-lg text-[var(--color-accent-primary)] focus:outline-none"
                                        />
                                        <span className="text-xs text-[var(--color-text-muted)]">Enter to save, Esc to cancel</span>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setEditingId(binding.id)}
                                        className="px-3 py-1.5 text-sm font-mono bg-[var(--color-void-700)] hover:bg-[var(--color-void-600)] border border-[var(--color-border-subtle)] rounded-lg text-[var(--color-text-secondary)] transition-all"
                                    >
                                        {formatKeybinding(binding)}
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            </SettingSection>
        </>
    );
}

interface EditorSettingsProps {
    currentTabSize: number;
    currentWordWrap: boolean;
    currentLineNumbers: boolean;
    currentMinimap: boolean;
    currentPersistentWorkspaceIndexEnabled: boolean;
    workspaceRootPath: string | null;
    workspaceCacheSummary: WorkspaceIndexCacheSummary | null;
    workspaceCacheError: string | null;
    isWorkspaceCacheLoading: boolean;
    isClearingWorkspaceCache: boolean;
    onTabSizeChange: (size: number) => void;
    onWordWrapChange: (enabled: boolean) => void;
    onLineNumbersChange: (enabled: boolean) => void;
    onMinimapChange: (enabled: boolean) => void;
    onPersistentWorkspaceIndexEnabledChange: (enabled: boolean) => void;
    onClearWorkspaceCache: () => Promise<void>;
}

function EditorSettings({
    currentTabSize,
    currentWordWrap,
    currentLineNumbers,
    currentMinimap,
    currentPersistentWorkspaceIndexEnabled,
    workspaceRootPath,
    workspaceCacheSummary,
    workspaceCacheError,
    isWorkspaceCacheLoading,
    isClearingWorkspaceCache,
    onTabSizeChange,
    onWordWrapChange,
    onLineNumbersChange,
    onMinimapChange,
    onPersistentWorkspaceIndexEnabledChange,
    onClearWorkspaceCache,
}: EditorSettingsProps) {
    const cachedRoot = workspaceCacheSummary?.cached_roots.find((root) => root.root_path === workspaceRootPath) || null;

    return (
        <>
            <SettingSection title="Editor" description="Configure code editor behavior and appearance">
                <SettingRow label="Tab Size" description="Number of spaces per tab (1-8)">
                    <div className="flex items-center gap-2">
                        {[2, 4, 8].map((size) => (
                            <button
                                key={size}
                                onClick={() => onTabSizeChange(size)}
                                className={`w-10 h-8 text-sm font-mono rounded-lg transition-all ${
                                    currentTabSize === size
                                        ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                        : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                                }`}
                            >
                                {size}
                            </button>
                        ))}
                    </div>
                </SettingRow>

                <SettingRow label="Word Wrap" description="Wrap long lines to fit the editor width">
                    <Toggle checked={currentWordWrap} onChange={onWordWrapChange} />
                </SettingRow>

                <SettingRow label="Line Numbers" description="Show line numbers in the gutter">
                    <Toggle checked={currentLineNumbers} onChange={onLineNumbersChange} />
                </SettingRow>

                <SettingRow label="Minimap" description="Show a minimap preview of the code on the right side">
                    <Toggle checked={currentMinimap} onChange={onMinimapChange} />
                </SettingRow>

                <SettingRow
                    label="Persistent Workspace Index"
                    description="Store workspace indexes on disk for faster reopen. Turn this off for tiny projects or low-RAM machines."
                >
                    <Toggle
                        checked={currentPersistentWorkspaceIndexEnabled}
                        onChange={onPersistentWorkspaceIndexEnabledChange}
                    />
                </SettingRow>
            </SettingSection>

            <SettingSection title="Workspace Cache" description="Persisted workspace indexes are stored on disk to speed up reopening projects.">
                <div className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-void-850)] overflow-hidden">
                    <div className="flex items-start justify-between gap-4 px-4 py-4 border-b border-[var(--color-border-subtle)]">
                        <div className="flex items-start gap-3">
                            <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-lg bg-[var(--color-accent-primary)]/12 text-[var(--color-accent-primary)]">
                                <Database className="w-4 h-4" />
                            </div>
                            <div>
                                <p className="text-sm font-medium text-[var(--color-text-primary)]">Persistent workspace index</p>
                                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                                    {isWorkspaceCacheLoading
                                        ? "Loading cache details..."
                                        : workspaceCacheSummary
                                            ? `${workspaceCacheSummary.workspace_count} cached workspace${workspaceCacheSummary.workspace_count === 1 ? "" : "s"} • ${formatBytes(workspaceCacheSummary.total_size_bytes)} on disk`
                                            : "No workspace cache data available."}
                                </p>
                                {!currentPersistentWorkspaceIndexEnabled && (
                                    <p className="text-xs text-[var(--color-accent-warning)] mt-2">
                                        Persistence is currently disabled. Indexes stay in memory only for this session.
                                    </p>
                                )}
                            </div>
                        </div>
                        <button
                            onClick={() => void onClearWorkspaceCache()}
                            disabled={isWorkspaceCacheLoading || isClearingWorkspaceCache || !workspaceCacheSummary || workspaceCacheSummary.workspace_count === 0}
                            className="flex items-center gap-2 px-3 py-2 text-xs font-medium rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-700)] text-[var(--color-text-secondary)] hover:bg-[var(--color-void-600)] hover:text-[var(--color-text-primary)] transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {isClearingWorkspaceCache ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            Clear Cache
                        </button>
                    </div>

                    <div className="px-4 py-4 space-y-4">
                        {workspaceCacheError && (
                            <div className="rounded-lg border border-[var(--color-accent-error)]/30 bg-[var(--color-accent-error)]/10 px-3 py-3 text-xs text-[var(--color-text-secondary)]">
                                {workspaceCacheError}
                            </div>
                        )}

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] px-3 py-3">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Cached Workspaces</p>
                                <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">{workspaceCacheSummary?.workspace_count ?? 0}</p>
                            </div>
                            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] px-3 py-3">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Indexed Files</p>
                                <p className="mt-2 text-lg font-semibold text-[var(--color-text-primary)]">{workspaceCacheSummary?.file_count ?? 0}</p>
                            </div>
                            <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] px-3 py-3">
                                <p className="text-[10px] uppercase tracking-wider text-[var(--color-text-muted)]">Last Indexed</p>
                                <p className="mt-2 text-sm font-medium text-[var(--color-text-primary)]">
                                    {workspaceCacheSummary?.last_indexed_at ? formatTimestamp(workspaceCacheSummary.last_indexed_at) : "Never"}
                                </p>
                            </div>
                        </div>

                        <div className="rounded-lg border border-[var(--color-border-subtle)] bg-[var(--color-void-800)] px-4 py-3">
                            <p className="text-sm font-medium text-[var(--color-text-primary)]">Current workspace</p>
                            <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                {workspaceRootPath || "No workspace currently open."}
                            </p>
                            {cachedRoot ? (
                                <p className="mt-2 text-xs text-[var(--color-text-secondary)]">
                                    Cached with {cachedRoot.file_count} files and {cachedRoot.directory_count} folders.
                                </p>
                            ) : workspaceRootPath ? (
                                <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                                    This workspace is not cached on disk yet.
                                </p>
                            ) : null}
                        </div>
                    </div>
                </div>
            </SettingSection>
        </>
    );
}

interface ExtensionsSettingsProps {
    currentInstallProvider: LspInstallProvider;
    extensions: {
        id: string;
        name: string;
        description: string;
        install_method: string;
        installed: boolean;
        installed_version?: string | null;
        coming_soon: boolean;
        version: string;
        latest_version: string;
        update_available: boolean;
        install_source?: string | null;
        executable_path?: string | null;
        error?: string | null;
    }[];
    isLoading: boolean;
    installInFlightIds: string[];
    onInstallProviderChange: (provider: LspInstallProvider) => void;
    onInstall: (id: string, provider: LspInstallProvider) => Promise<void>;
    onUpdate: (id: string, provider: LspInstallProvider) => Promise<void>;
    onUninstall: (id: string) => Promise<void>;
    onRefresh: () => Promise<void>;
}

function ExtensionsSettings({
    currentInstallProvider,
    extensions,
    isLoading,
    installInFlightIds,
    onInstallProviderChange,
    onInstall,
    onUpdate,
    onUninstall,
    onRefresh,
}: ExtensionsSettingsProps) {
    return (
        <>
            <SettingSection title="LSP Extensions" description="Manage built-in and marketplace language servers.">
                <SettingRow label="Node Install Provider" description="Used for TypeScript and Pyright. Rust downloads from GitHub Releases.">
                    <div className="flex items-center gap-2">
                        {(["pnpm", "npm", "bun"] as const).map((provider) => (
                            <button
                                key={provider}
                                onClick={() => provider !== "bun" && onInstallProviderChange(provider)}
                                className={`px-3 py-1.5 rounded-lg text-sm transition-all ${
                                    currentInstallProvider === provider
                                        ? "bg-[var(--color-accent-primary)] text-[var(--color-surface-base)]"
                                        : "bg-[var(--color-void-700)] text-[var(--color-text-secondary)]"
                                } ${provider === "bun" ? "opacity-60 cursor-not-allowed" : ""}`}
                            >
                                {provider === "bun" ? "bun (Soon)" : provider}
                            </button>
                        ))}
                    </div>
                </SettingRow>
            </SettingSection>

            <SettingSection title="Available Language Servers" description="Install and manage runtime support for each language.">
                <div className="space-y-3">
                    <div className="flex items-center justify-between">
                        <span className="text-xs text-[var(--color-text-muted)]">
                            {isLoading ? "Refreshing extension statuses..." : `${extensions.length} entries`}
                        </span>
                        <button
                            onClick={() => void onRefresh()}
                            className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)]"
                        >
                            Refresh
                        </button>
                    </div>

                    {extensions.map((extension) => {
                        const installing = installInFlightIds.includes(extension.id);
                        return (
                            <div
                                key={extension.id}
                                className="rounded-xl border border-[var(--color-border-subtle)] bg-[var(--color-void-850)] px-4 py-4"
                            >
                                <div className="flex items-start justify-between gap-4">
                                    <div>
                                        <div className="flex items-center gap-2">
                                            <p className="text-sm font-medium text-[var(--color-text-primary)]">
                                                {extension.name}
                                            </p>
                                            {extension.installed && (
                                                <span className="text-[10px] uppercase tracking-widest text-[var(--color-accent-success)]">
                                                    Installed
                                                </span>
                                            )}
                                            {extension.update_available && (
                                                <span className="text-[10px] uppercase tracking-widest text-[var(--color-accent-warning)]">
                                                    Update Available
                                                </span>
                                            )}
                                            {extension.coming_soon && (
                                                <span className="text-[10px] uppercase tracking-widest text-[var(--color-accent-warning)]">
                                                    Coming Soon
                                                </span>
                                            )}
                                        </div>
                                        <p className="mt-1 text-xs text-[var(--color-text-muted)]">
                                            {extension.description}
                                        </p>
                                        <p className="mt-2 text-[11px] text-[var(--color-text-secondary)] font-mono">
                                            {extension.install_method} • {extension.latest_version === "latest" ? "latest" : `latest ${extension.latest_version}`}
                                            {extension.installed_version ? ` • installed ${extension.installed_version}` : ""}
                                        </p>
                                        <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">
                                            Source: {extension.install_source ?? "missing"}
                                        </p>
                                        {extension.error && (
                                            <p className="mt-2 text-[11px] text-[var(--color-accent-error)]">
                                                {extension.error}
                                            </p>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {!extension.installed ? (
                                            <button
                                                onClick={() => void onInstall(extension.id, currentInstallProvider)}
                                                disabled={installing || extension.coming_soon}
                                                className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] disabled:opacity-50"
                                            >
                                                {installing ? "Installing..." : "Install"}
                                            </button>
                                        ) : (
                                            <>
                                                <button
                                                    onClick={() => void onUpdate(extension.id, currentInstallProvider)}
                                                    disabled={installing || extension.coming_soon}
                                                    className="px-3 py-1.5 text-xs rounded-lg bg-[var(--color-accent-primary)] text-[var(--color-surface-base)] disabled:opacity-50"
                                                >
                                                    {installing ? "Working..." : extension.update_available ? "Update" : "Reinstall"}
                                                </button>
                                                <button
                                                    onClick={() => void onUninstall(extension.id)}
                                                    disabled={installing}
                                                    className="px-3 py-1.5 text-xs rounded-lg border border-[var(--color-border-subtle)] text-[var(--color-text-secondary)] disabled:opacity-50"
                                                >
                                                    Uninstall
                                                </button>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>
            </SettingSection>
        </>
    );
}

function formatBytes(bytes: number) {
    if (bytes <= 0) {
        return "0 B";
    }

    const units = ["B", "KB", "MB", "GB"];
    let size = bytes;
    let unitIndex = 0;

    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex += 1;
    }

    return `${size >= 10 || unitIndex === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[unitIndex]}`;
}

function formatTimestamp(timestamp: number) {
    return new Date(timestamp).toLocaleString();
}
