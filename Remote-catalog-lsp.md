# Remote LSP Catalog Plan

## Goal

Move the bundled V1 LSP catalog to a remote or hybrid catalog without changing the install/runtime model inside the app.

## Proposed manifest shape

- `id`
- `name`
- `languageIds`
- `fileExtensions`
- `installMethod`
- `packageName` or release asset metadata
- `platformSupport`
- `version`
- `bundledByDefault`
- `comingSoon`
- `description`

## Migration path

### Step 1

- Keep the bundled manifest as the default local source of truth.
- Add remote fetch support behind a fallback chain:
  - remote catalog if available
  - bundled catalog if remote fails

### Step 2

- Cache the last successful remote catalog locally in app data.
- Prefer remote cache when offline if it is newer than the bundled manifest.

### Step 3

- Add integrity/version validation for remote responses.
- Introduce catalog schema versioning.

## Fallback behavior

- If remote fetch fails, use bundled manifest immediately.
- If remote fetch succeeds but parse/validation fails, log the error and continue with bundled manifest.
- Never block editor startup on remote catalog availability.

## Free hosting options

- GitHub Pages serving a static JSON manifest
- raw JSON in a public GitHub repository
- GitHub Releases metadata for downloadable binaries/assets
- Cloudflare Pages
- Cloudflare Workers for lightweight API wrapping
- Vercel static hosting
- Supabase storage or database if the catalog later becomes relational

## Recommended first remote option

- Use GitHub first:
  - keep a public repo with `catalog.json`
  - serve through GitHub Pages or raw content
  - store downloadable assets in GitHub Releases where needed

This keeps V2 cheap, easy to update, and simple to debug.
