# VoiDesk LSP Plan

## Summary

This document captures the agreed LSP/runtime plan exactly before implementation. VoiDesk will move from PATH-dependent language servers to app-managed runtimes, ship first-class support for TypeScript, Python, and Rust, and introduce an LSP-only extensions surface for other languages. The sidebar navigation controls will also gain a switchable VS Code-style activity bar mode.

## V1

### Runtime model

- Replace PATH-dependent LSP discovery with an app-owned runtime registry in the Tauri backend.
- Treat TypeScript, Pyright, and Rust Analyzer as first-class managed runtimes.
- Launch servers lazily on first matching file/workspace open.
- Keep one server process per supported language/workspace as today; do not prestart servers at app boot.
- If a runtime is missing, the backend must return a structured “runtime not installed” result instead of repeated request timeouts.

### Install and delivery

- TypeScript LSP: install via `pnpm` into an app-managed tools directory.
- Pyright: install via `pnpm` into the same app-managed tools directory.
- Rust Analyzer: download platform-specific binary from GitHub Releases into the app-managed tools directory.
- Add launch metadata per runtime:
  - executable path
  - args
  - install source (`pnpm` or `github_release`)
  - installed version
  - install status
  - last error

### Marketplace / extensions surface

- Add an LSP-only extensions page in Settings first, not a general plugin system.
- Bundle a local manifest describing available LSP extensions and built-ins.
- Manifest fields:
  - `id`
  - `name`
  - `languageIds`
  - `fileExtensions`
  - `installMethod` (`pnpm`, `github_release`)
  - `packageName` or release asset metadata
  - `platformSupport`
  - `version`
  - `bundledByDefault`
  - `comingSoon`
  - `description`
- When a file is opened whose language has no installed runtime:
  - show a top-of-editor prompt/toast
  - include action to open the LSP Extensions settings page
  - do not show the prompt repeatedly for the same file/language during the same session after dismissal
- Rust is included in supported managed runtimes in V1 and must not rely on global `rustup`/PATH resolution.

### Install settings

- Add an “Extensions” or “LSP Extensions” section to Settings.
- Add install-provider preference for Node-based LSPs:
  - `pnpm` default
  - `npm` selectable
  - `bun` visible but marked “Coming soon”
- Use the selected package manager only for Node-based runtimes such as TypeScript LSP and Pyright.
- Rust Analyzer ignores the package-manager choice and always uses GitHub Releases.
- Store install directory and install-provider preference in persisted settings.
- Show per-extension states:
  - Installed
  - Not installed
  - Installing
  - Update available
  - Failed
- Include install, reinstall, update, and uninstall actions.

### Sidebar / activity bar layout

- Add a new layout setting for navigation controls with two modes:
  - integrated sidebar strip
  - VS Code-style activity bar
- In VS Code-style mode:
  - render a separate narrow icon bar on the far left of the app
  - move Explorer/Search/Problems/Symbols controls there
  - keep the main sidebar content panel immediately to the right
- Add alignment setting for the activity icons:
  - top
  - bottom
- Preserve current integrated behavior as the default layout unless explicitly changed.
- Do not mix icon strip placement logic into the file tree header once activity bar mode is active.

### Public interfaces

- Add backend runtime commands for:
  - list available LSP extensions
  - get installed runtime status
  - install runtime
  - uninstall runtime
  - update runtime
- Add frontend settings/types for:
  - `lspInstallProvider: "pnpm" | "npm" | "bun"`
  - `sidebarNavigationMode: "integrated" | "activity_bar"`
  - `activityBarAlignment: "top" | "bottom"`

## V2

### Remote catalog

- Move from bundled-only catalog to a remote or hybrid catalog.
- Keep bundled manifest support as fallback.
- Add a separate plan doc named `Remote-catalog-lsp.md`.
- The doc should describe:
  - proposed remote manifest schema
  - update flow from bundled-only to remote/hybrid
  - cache/fallback behavior
  - integrity/versioning considerations
  - free hosting options

### Suggested free hosting options

- GitHub Pages hosting a static JSON manifest
- raw JSON in a public GitHub repo
- GitHub Releases metadata as a source for downloadable assets
- Cloudflare Pages or Workers
- Vercel static hosting
- Supabase storage/db if metadata later becomes relational

## Defaults and assumptions

- Default install provider: `pnpm`
- Default catalog source in V1: bundled-only
- Default navigation layout: integrated sidebar strip
- “Sleep/idle” means “not launched until needed”; no background resident server pool is added in V1
- Extension system scope remains LSP-only for this iteration; no general plugin marketplace is introduced
