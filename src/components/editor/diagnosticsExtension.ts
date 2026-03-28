import { RangeSet, RangeSetBuilder, StateEffect, StateField } from "@codemirror/state";
import {
    Decoration,
    DecorationSet,
    EditorView,
    GutterMarker,
    gutter,
    hoverTooltip,
    Tooltip,
} from "@codemirror/view";

import { LspDiagnostic, getDiagnosticSeverityBucket } from "@/stores/diagnosticsStore";

export const setDiagnosticsEffect = StateEffect.define<LspDiagnostic[]>();
export const flashLineEffect = StateEffect.define<number | null>();

class DiagnosticMarker extends GutterMarker {
    constructor(private readonly severity: string) {
        super();
    }

    toDOM() {
        const element = document.createElement("div");
        element.className = `cm-diagnostic-marker cm-diagnostic-marker-${this.severity}`;
        return element;
    }
}

const diagnosticsStateField = StateField.define<LspDiagnostic[]>({
    create() {
        return [];
    },
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setDiagnosticsEffect)) {
                return effect.value;
            }
        }

        return value;
    },
});

const diagnosticField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, transaction) {
        decorations = decorations.map(transaction.changes);

        for (const effect of transaction.effects) {
            if (effect.is(setDiagnosticsEffect)) {
                return buildDiagnosticDecorations(transaction.state.doc.toString(), effect.value);
            }
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

const diagnosticGutterField = StateField.define<RangeSet<GutterMarker>>({
    create() {
        return RangeSet.empty;
    },
    update(value, transaction) {
        for (const effect of transaction.effects) {
            if (effect.is(setDiagnosticsEffect)) {
                return buildGutterMarkers(transaction.state.doc.toString(), effect.value);
            }
        }
        return value.map(transaction.changes);
    },
    provide: (field) =>
        gutter({
            class: "cm-diagnostics-gutter",
            markers: (view) => view.state.field(field),
        }),
});

const flashField = StateField.define<DecorationSet>({
    create() {
        return Decoration.none;
    },
    update(decorations, transaction) {
        decorations = decorations.map(transaction.changes);

        for (const effect of transaction.effects) {
            if (effect.is(flashLineEffect)) {
                if (effect.value === null) {
                    return Decoration.none;
                }

                const line = transaction.state.doc.line(Math.min(Math.max(effect.value, 1), transaction.state.doc.lines));
                return Decoration.set([
                    Decoration.line({
                        attributes: {
                            class: "cm-navigation-flash",
                        },
                    }).range(line.from),
                ]);
            }
        }

        return decorations;
    },
    provide: (field) => EditorView.decorations.from(field),
});

export function diagnosticsExtension() {
    return [
        diagnosticsStateField,
        diagnosticField,
        diagnosticGutterField,
        flashField,
        hoverTooltip((view, pos): Tooltip | null => {
            const diagnostics = view.state.field(diagnosticsStateField);
            const relevant = diagnostics.filter((diagnostic) => containsPosition(diagnostic, view.state.doc.toString(), pos));
            if (relevant.length === 0) {
                return null;
            }

            return {
                pos,
                above: true,
                create: () => {
                    const dom = document.createElement("div");
                    dom.className = "lsp-diagnostics-tooltip";

                    for (const diagnostic of relevant) {
                        const item = document.createElement("div");
                        item.className = `lsp-diagnostics-tooltip-item lsp-diagnostics-tooltip-item-${getDiagnosticSeverityBucket(
                            diagnostic.severity
                        )}`;

                        const title = document.createElement("div");
                        title.className = "lsp-diagnostics-tooltip-message";
                        title.textContent = diagnostic.message;

                        const meta = document.createElement("div");
                        meta.className = "lsp-diagnostics-tooltip-meta";
                        meta.textContent = [diagnostic.source, diagnostic.code].filter(Boolean).join(" • ");

                        item.appendChild(title);
                        if (meta.textContent) {
                            item.appendChild(meta);
                        }
                        dom.appendChild(item);
                    }

                    return { dom };
                },
            };
        }),
    ];
}

function buildDiagnosticDecorations(doc: string, diagnostics: LspDiagnostic[]) {
    const builder = new RangeSetBuilder<Decoration>();
    const sortedDiagnostics = [...diagnostics].sort((left, right) => {
        const leftStart = offsetFromPosition(doc, left.range.start.line, left.range.start.character);
        const rightStart = offsetFromPosition(doc, right.range.start.line, right.range.start.character);
        return leftStart - rightStart;
    });

    for (const diagnostic of sortedDiagnostics) {
        const severity = getDiagnosticSeverityBucket(diagnostic.severity);
        const lineStart = offsetFromPosition(doc, diagnostic.range.start.line, diagnostic.range.start.character);
        const rawEnd = offsetFromPosition(doc, diagnostic.range.end.line, diagnostic.range.end.character);
        const end = rawEnd > lineStart ? rawEnd : nextUnderlineBoundary(doc, lineStart);

        if (end <= lineStart) {
            continue;
        }

        builder.add(
            lineStart,
            end,
            Decoration.mark({
                attributes: {
                    class: `cm-diagnostic-range cm-diagnostic-range-${severity}`,
                },
            })
        );
    }

    return builder.finish();
}

function buildGutterMarkers(doc: string, diagnostics: LspDiagnostic[]) {
    const builder = new RangeSetBuilder<GutterMarker>();
    const lines = new Map<number, string>();

    for (const diagnostic of diagnostics) {
        const line = diagnostic.range.start.line;
        const severity = getDiagnosticSeverityBucket(diagnostic.severity);
        const existing = lines.get(line);

        if (!existing || compareSeverity(severity, existing) < 0) {
            lines.set(line, severity);
        }
    }

    const sortedLines = [...lines.entries()].sort(([left], [right]) => left - right);

    for (const [line, severity] of sortedLines) {
        const offset = offsetFromPosition(doc, line, 0);
        builder.add(offset, offset, new DiagnosticMarker(severity));
    }

    return builder.finish();
}

function compareSeverity(left: string, right: string) {
    const order = ["error", "warning", "info", "hint"];
    return order.indexOf(left) - order.indexOf(right);
}

function containsPosition(diagnostic: LspDiagnostic, doc: string, pos: number) {
    const start = offsetFromPosition(doc, diagnostic.range.start.line, diagnostic.range.start.character);
    const rawEnd = offsetFromPosition(doc, diagnostic.range.end.line, diagnostic.range.end.character);
    const end = rawEnd > start ? rawEnd : nextUnderlineBoundary(doc, start);
    return pos >= start && pos <= end;
}

function nextUnderlineBoundary(doc: string, start: number) {
    if (start >= doc.length) return start;
    if (doc[start] === "\n") return start;
    return start + 1;
}

function offsetFromPosition(doc: string, line: number, character: number) {
    let currentLine = 0;
    let index = 0;

    while (currentLine < line && index < doc.length) {
        if (doc[index] === "\n") {
            currentLine += 1;
        }
        index += 1;
    }

    let chars = 0;
    while (chars < character && index < doc.length && doc[index] !== "\n") {
        index += 1;
        chars += 1;
    }

    return index;
}
