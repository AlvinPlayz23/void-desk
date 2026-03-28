# VoiDesk Workspace and Editor Gap Checklist

This document lists the highest-priority changes needed to make VoiDesk feel closer to a mature IDE like VS Code. The order is intentional: items at the top unlock the rest.

## P0 - Must Have

- [x] Build a real workspace index instead of relying on repeated tree scans.
  - Why: the current project view is filesystem-driven and rebuilt on refresh. That works for small projects, but it does not scale into a true workspace model.
  - What to add: a background index of files, folders, ignore rules, file hashes, and last-known metadata.
  - Result: faster refreshes, better search, and a foundation for symbol-aware features.

- [ ] Add diagnostics end to end.
  - Why: the editor currently has completion and hover, but no squiggles/problems pipeline.
  - What to add: LSP `publishDiagnostics` handling, a diagnostics store, editor decorations, and a Problems panel.
  - Result: users see errors in context instead of discovering them manually.

- [ ] Add go-to-definition, find references, and rename symbol.
  - Why: this is one of the biggest gaps between a code editor and a real IDE.
  - What to add: LSP requests for definition, references, and rename, plus UI jump targets and previews.
  - Result: code navigation becomes structural instead of file-only.

- [x] Make search use a proper workspace engine.
  - Why: the current search implementation walks files directly with caps and filters. That is acceptable, but it is not yet a high-scale workspace search experience.
  - What to add: ripgrep-backed search or a worker/index hybrid, incremental result updates, and better ignore handling.
  - Result: faster searches on large repos and better parity with VS Code.

## P1 - Strongly Recommended

- [ ] Support multiple workspace roots.
  - Why: many real projects span packages, apps, and shared libraries.
  - What to add: a workspace model that can open several roots at once, with root-specific search and tree views.
  - Result: better monorepo support.

- [ ] Add a Problems panel and file-level issue summaries.
  - Why: diagnostics need a central place to live, not just editor decorations.
  - What to add: grouped issues by file, severity filters, quick navigation, and issue counts in the file tree.
  - Result: users can triage project health quickly.

- [ ] Improve language-server lifecycle management.
  - Why: the current bridge sends open/change/completion/hover, but it needs more lifecycle depth and better server coordination.
  - What to add: close notifications, restart handling, per-language capabilities, and better request cancellation.
  - Result: fewer stale responses and more reliable editor intelligence.

- [ ] Persist and restore more workspace state.
  - Why: opening files is restored, but richer workspace state is still limited.
  - What to add: expanded explorer state, diagnostics, search state, terminal sessions, and AI context state.
  - Result: the app feels like a workspace manager, not just a folder opener.

- [ ] Surface git status in the explorer.
  - Why: file state is much easier to understand when users can see modified, added, and deleted files directly.
  - What to add: repository detection, file badges, diff previews, and staging actions.
  - Result: a much more complete development workflow.

## P2 - Important for Polish

- [ ] Stop recreating the editor more than necessary.
  - Why: rebuilding the CodeMirror view on theme and settings changes is simple, but it is not ideal for long-lived editor state.
  - What to add: smaller targeted configuration updates, preserved view state, and less full teardown.
  - Result: smoother editing and less risk of state loss.

- [ ] Improve file-tree performance on large projects.
  - Why: the current tree is recursive and bounded, but still rebuild-heavy.
  - What to add: lazy folder expansion, virtualization, cached metadata, and incremental updates from watcher events.
  - Result: better responsiveness on large repos.

- [ ] Reduce log noise and tighten type safety in editor/workspace hooks.
  - Why: the codebase still has a lot of debug logging and `any` usage in key paths.
  - What to add: typed command responses, structured error handling, and a cleaner logging policy.
  - Result: easier maintenance and fewer hidden bugs.

- [ ] Add project-wide symbol and file search UI entry points.
  - Why: even when the backend supports richer data, users need obvious ways to access it.
  - What to add: command palette items, sidebar sections, and keyboard shortcuts.
  - Result: the new capabilities become discoverable.

## P3 - Competitive Features

- [ ] Add task runner and build/test integrations.
  - Why: users expect an IDE to run project tasks without leaving the app.
  - What to add: task definitions, output panels, and reusable terminal task presets.

- [ ] Add code actions and quick fixes.
  - Why: these often turn diagnostics into a usable workflow.
  - What to add: LSP code action requests, lightbulb UI, and fix-on-click actions.

- [ ] Add smarter workspace search filters.
  - Why: advanced search is only useful when it can narrow by language, folder, symbol, or git state.
  - What to add: richer filters and result grouping.

- [ ] Add extension/plugin support eventually.
  - Why: VS Code's biggest moat is its ecosystem.
  - What to add: a stable command and contribution surface before any plugin model.

## Suggested Build Order

1. Diagnostics and Problems panel.
2. Definition/references/rename.
3. Workspace index.
4. Better search engine.
5. Git integration.
6. Multi-root workspace support.
7. Editor state preservation and performance cleanup.

## Where To Start In This Codebase

- `src-tauri/src/commands/lsp_commands.rs`
- `src-tauri/src/lsp/manager.rs`
- `src/hooks/useLsp.ts`
- `src/components/editor/CodeEditor.tsx`
- `src-tauri/src/commands/search_commands.rs`
- `src-tauri/src/commands/project_commands.rs`
- `src/hooks/useFileWatcher.ts`
- `src/stores/fileStore.ts`

## Short Conclusion

VoiDesk does not need to copy VS Code feature-for-feature. It needs a deeper workspace model, a stronger language-intelligence pipeline, and better state persistence. Once those are in place, the current AI-first direction becomes much more credible.
