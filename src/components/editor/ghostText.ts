import {
    EditorView,
    Decoration,
    DecorationSet,
    WidgetType,
    keymap,
} from "@codemirror/view";
import { StateField, StateEffect, Prec } from "@codemirror/state";

export interface GhostTextState {
    text: string | null;
    pos: number;
}

export const setGhostText = StateEffect.define<GhostTextState>();
export const clearGhostText = StateEffect.define<void>();

class GhostTextWidget extends WidgetType {
    constructor(readonly text: string) {
        super();
    }

    toDOM(): HTMLElement {
        const container = document.createElement("span");
        container.className = "cm-ghost-text-container";
        container.style.cssText = "position: relative; display: inline;";

        // Ghost text itself
        const span = document.createElement("span");
        span.className = "cm-ghost-text";
        span.textContent = this.text;
        span.style.cssText = `
            opacity: 0.4;
            font-style: italic;
            color: var(--color-text-secondary, #888);
            pointer-events: none;
            white-space: pre;
        `;
        container.appendChild(span);

        // Hint tooltip
        const hint = document.createElement("span");
        hint.className = "cm-ghost-text-hint";
        hint.innerHTML = `<span style="opacity:0.7">Tab</span> accept · <span style="opacity:0.7">Ctrl+→</span> word · <span style="opacity:0.7">Esc</span> dismiss`;
        hint.style.cssText = `
            position: absolute;
            top: 1.4em;
            left: 0;
            background: var(--color-void-800, #1a1a1a);
            border: 1px solid var(--color-border-subtle, #333);
            border-radius: 4px;
            padding: 2px 6px;
            font-size: 10px;
            color: var(--color-text-tertiary, #666);
            white-space: nowrap;
            z-index: 100;
            pointer-events: none;
            box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        `;
        container.appendChild(hint);

        return container;
    }

    eq(other: GhostTextWidget): boolean {
        return this.text === other.text;
    }

    ignoreEvent(): boolean {
        return true;
    }
}

const ghostTextField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, tr) {
        for (const effect of tr.effects) {
            if (effect.is(setGhostText)) {
                const { text, pos } = effect.value;
                if (text) {
                    const widget = Decoration.widget({
                        widget: new GhostTextWidget(text),
                        side: 1,
                    });
                    return Decoration.set([widget.range(pos)]);
                }
                return Decoration.none;
            }
            if (effect.is(clearGhostText)) {
                return Decoration.none;
            }
        }
        if (tr.docChanged) {
            return Decoration.none;
        }
        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export interface GhostTextCallbacks {
    onAcceptAll: () => string | null;
    onAcceptWord: () => string | null;
    onDismiss: () => void;
    hasCompletion: () => boolean;
}

export function createGhostTextKeymap(callbacksRef: React.MutableRefObject<GhostTextCallbacks>) {
    return Prec.highest(
        keymap.of([
            {
                key: "Tab",
                run: (view) => {
                    const callbacks = callbacksRef.current;
                    if (!callbacks.hasCompletion()) {
                        return false; // Let default Tab behavior happen
                    }
                    const text = callbacks.onAcceptAll();
                    if (text) {
                        const pos = view.state.selection.main.head;
                        view.dispatch({
                            changes: { from: pos, insert: text },
                            selection: { anchor: pos + text.length },
                            effects: clearGhostText.of(undefined),
                        });
                        return true;
                    }
                    return false;
                },
            },
            {
                key: "Ctrl-ArrowRight",
                mac: "Cmd-ArrowRight",
                run: (view) => {
                    const callbacks = callbacksRef.current;
                    if (!callbacks.hasCompletion()) {
                        return false;
                    }
                    const word = callbacks.onAcceptWord();
                    if (word) {
                        const pos = view.state.selection.main.head;
                        view.dispatch({
                            changes: { from: pos, insert: word },
                            selection: { anchor: pos + word.length },
                        });
                        return true;
                    }
                    return false;
                },
            },
            {
                key: "Escape",
                run: () => {
                    const callbacks = callbacksRef.current;
                    if (callbacks.hasCompletion()) {
                        callbacks.onDismiss();
                        return true;
                    }
                    return false;
                },
            },
        ])
    );
}

export function ghostTextExtension() {
    return [ghostTextField];
}
