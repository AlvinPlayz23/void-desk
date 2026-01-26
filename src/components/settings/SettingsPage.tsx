import { useState, useEffect, useRef, useMemo } from "react";
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
} from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { useUIStore, SettingsCategory, Theme } from "@/stores/uiStore";
import { useSettingsStore, KeyBinding } from "@/stores/settingsStore";

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
    // AI
    openAIKey?: string;
    openAIBaseUrl?: string;
    openAIModelId?: string;
    inlineCompletionsEnabled?: boolean;
    // Editor
    tabSize?: number;
    wordWrap?: boolean;
    lineNumbers?: boolean;
    minimap?: boolean;
    // Keybindings
    keybindings?: KeyBinding[];
}

export function SettingsPage() {
    const { isSettingsPageOpen, closeSettingsPage, settingsCategory, setSettingsCategory, theme, setTheme } = useUIStore();
    const settings = useSettingsStore();
    const [searchQuery, setSearchQuery] = useState("");
    const [pending, setPending] = useState<PendingSettings>({});
    const [hasChanges, setHasChanges] = useState(false);
    const [showSaved, setShowSaved] = useState(false);

    // Reset pending changes when opening
    useEffect(() => {
        if (isSettingsPageOpen) {
            setPending({});
            setHasChanges(false);
        }
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
        if (pending.openAIKey !== undefined) settings.setOpenAIKey(pending.openAIKey);
        if (pending.openAIBaseUrl !== undefined) settings.setOpenAIBaseUrl(pending.openAIBaseUrl);
        if (pending.openAIModelId !== undefined) settings.setOpenAIModelId(pending.openAIModelId);
        if (pending.inlineCompletionsEnabled !== undefined) settings.setInlineCompletionsEnabled(pending.inlineCompletionsEnabled);
        if (pending.tabSize !== undefined) settings.setTabSize(pending.tabSize);
        if (pending.wordWrap !== undefined) settings.setWordWrap(pending.wordWrap);
        if (pending.lineNumbers !== undefined) settings.setLineNumbers(pending.lineNumbers);
        if (pending.minimap !== undefined) settings.setMinimap(pending.minimap);
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
                                onThemeChange={(v) => updatePending("theme", v)}
                                onFontSizeChange={(v) => updatePending("editorFontSize", v)}
                                onFontFamilyChange={(v) => updatePending("editorFontFamily", v)}
                                onUIScaleChange={(v) => updatePending("uiScale", v)}
                            />
                        )}
                        {settingsCategory === "ai" && (
                            <AISettings
                                currentKey={getValue("openAIKey", settings.openAIKey)}
                                currentBaseUrl={getValue("openAIBaseUrl", settings.openAIBaseUrl)}
                                currentModelId={getValue("openAIModelId", settings.openAIModelId)}
                                currentInlineEnabled={getValue("inlineCompletionsEnabled", settings.inlineCompletionsEnabled)}
                                onKeyChange={(v) => updatePending("openAIKey", v)}
                                onBaseUrlChange={(v) => updatePending("openAIBaseUrl", v)}
                                onModelIdChange={(v) => updatePending("openAIModelId", v)}
                                onInlineEnabledChange={(v) => updatePending("inlineCompletionsEnabled", v)}
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
                                onTabSizeChange={(v) => updatePending("tabSize", v)}
                                onWordWrapChange={(v) => updatePending("wordWrap", v)}
                                onLineNumbersChange={(v) => updatePending("lineNumbers", v)}
                                onMinimapChange={(v) => updatePending("minimap", v)}
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
    onThemeChange: (theme: Theme) => void;
    onFontSizeChange: (size: number) => void;
    onFontFamilyChange: (family: string) => void;
    onUIScaleChange: (scale: number) => void;
}

function AppearanceSettings({
    currentTheme,
    currentFontSize,
    currentFontFamily,
    currentUIScale,
    onThemeChange,
    onFontSizeChange,
    onFontFamilyChange,
    onUIScaleChange,
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
            </SettingSection>
        </>
    );
}

interface AISettingsProps {
    currentKey: string;
    currentBaseUrl: string;
    currentModelId: string;
    currentInlineEnabled: boolean;
    onKeyChange: (key: string) => void;
    onBaseUrlChange: (url: string) => void;
    onModelIdChange: (id: string) => void;
    onInlineEnabledChange: (enabled: boolean) => void;
}

function AISettings({
    currentKey,
    currentBaseUrl,
    currentModelId,
    currentInlineEnabled,
    onKeyChange,
    onBaseUrlChange,
    onModelIdChange,
    onInlineEnabledChange,
}: AISettingsProps) {
    const [isTesting, setIsTesting] = useState(false);
    const [testResult, setTestResult] = useState<{ success: boolean; message: string } | null>(null);

    const handleTest = async () => {
        setIsTesting(true);
        setTestResult(null);
        try {
            const result = await invoke<string>("test_ai_connection", {
                apiKey: currentKey,
                baseUrl: currentBaseUrl,
                modelId: currentModelId,
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

                    <div className="space-y-2">
                        <label className="flex items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                            <Sparkles className="w-4 h-4 text-[var(--color-text-muted)]" />
                            Model ID
                        </label>
                        <input
                            type="text"
                            value={currentModelId}
                            onChange={(e) => onModelIdChange(e.target.value)}
                            placeholder="gpt-4o"
                            className="w-full bg-[var(--color-void-800)] border border-[var(--color-border-subtle)] rounded-lg px-4 py-2.5 text-sm text-[var(--color-text-primary)] focus:outline-none focus:border-[var(--color-accent-primary)] transition-colors"
                        />
                        <p className="text-xs text-[var(--color-text-muted)]">The specific model to use (e.g., gpt-4o, gpt-3.5-turbo, claude-3-opus).</p>
                    </div>

                    <SettingRow label="Inline AI Completions" description="Show AI-powered ghost text suggestions as you type. Press Tab to accept.">
                        <Toggle checked={currentInlineEnabled} onChange={onInlineEnabledChange} />
                    </SettingRow>

                    {/* Test Connection Button */}
                    <div className="flex items-center gap-3 pt-4">
                        <button
                            onClick={handleTest}
                            disabled={isTesting || !currentKey}
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
    const { resetKeybindings, getKeybindingConflicts } = useSettingsStore();
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
    onTabSizeChange: (size: number) => void;
    onWordWrapChange: (enabled: boolean) => void;
    onLineNumbersChange: (enabled: boolean) => void;
    onMinimapChange: (enabled: boolean) => void;
}

function EditorSettings({
    currentTabSize,
    currentWordWrap,
    currentLineNumbers,
    currentMinimap,
    onTabSizeChange,
    onWordWrapChange,
    onLineNumbersChange,
    onMinimapChange,
}: EditorSettingsProps) {
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
            </SettingSection>
        </>
    );
}
