# AI Chat Improvements Plan

## Goals
- Restore access to previous chat sessions after creating a new chat.
- Persist sessions beyond runtime and keep them scoped to the workspace that created them.
- Add a retry strategy for the specific 429 rate-limit streaming error.

## Scope Decisions
- Use the existing Zustand `persist` store as the primary persistence layer (localStorage) to keep implementation minimal and avoid introducing SQLite unless required later.
- Add workspace scoping to sessions: sessions appear only when their workspace is open; global sessions (no workspace) appear everywhere.
- Implement automatic and manual retry logic for a 429 error without changing request payloads.

## Data Model Updates
- Extend `ChatSession` to include `workspacePath: string | null`.
- Store the current workspace path on session creation.

## UI Changes (AI Chat)
- Replace backend session listing in the dropdown with local Zustand sessions.
- Filter sessions by `workspacePath`:
  - `null` (global sessions) always visible.
  - Workspace sessions visible only when `rootPath` matches.
- Sort sessions by `lastUpdated` for recency.
- Add a retry control below messages when the last assistant message contains the target 429 error string.

## Hook Changes (useAI)
- Track the last user message and retry attempt count.
- Add automatic retry for 429 errors:
  - Detect the error string `Invalid status code: 429` in stream errors.
  - Retry once after a short delay, replacing the failed assistant message.
- Expose `retryLastMessage` for manual retries.

## Backend Notes
- No changes required in Rust unless we later move persistence to SQLite.
- If SQLite is desired later, add a Tauri command for session CRUD and migrate the dropdown to use backend storage.

## Acceptance Criteria
- Creating a new chat does not hide existing sessions.
- Sessions only appear for the workspace they were created in, except global sessions.
- 429 errors trigger a single auto-retry; if it still fails, a visible retry button appears.

## Follow-up (Optional)
- Add SQLite-based session storage for cross-session persistence with metadata (e.g., message counts, timestamps).
- Add per-session rename and delete in the UI.
