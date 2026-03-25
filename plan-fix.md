# AI Chat Performance Fix Plan

## Findings

1. Streaming assistant updates currently rewrite and persist the full chat session state on every chunk.
2. The chat panel re-renders the full transcript and re-parses markdown for old messages during streaming.
3. The chat panel duplicates session derivation in local component state, adding extra render work.
4. The frontend sends full prior history to the backend, and only the backend trims it afterward.
5. `useAI` subscribes too broadly to the chat store, so unrelated store changes can trigger extra rerenders.
6. The backend session store retains full message history in memory for the life of the app process.

## Solution

1. Replace eager per-update persisted writes with debounced chat-store persistence.
2. Keep attachment payloads out of persisted chat data and preserve stable message ids for rendering.
3. Memoize expensive chat row renderers so old messages do not re-parse markdown on each stream chunk.
4. Use stable message keys instead of array indexes for transcript rows.
5. Derive session lists with memoization instead of copying store state into component-local state.
6. Trim conversation history on the frontend before invoking `ask_ai_stream_with_session`.
7. Read chat-store actions via narrow selectors instead of subscribing `useAI` to the whole store.
8. Prune backend session message history after completed runs so long-lived app sessions do not keep growing forever.

## Priority Order

1. Findings 1, 2, and 3.
2. Findings 4 and 5.
3. Finding 6.

## Verification

- Run `pnpm typecheck`.
- Manually verify that long streamed responses keep updating smoothly.
- Confirm chat sessions still persist across reloads.
- Confirm retry, tool-operation rendering, and debug logs still work.
