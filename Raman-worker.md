# Raman Worker State

## Exact Task Given

### Parent task context

Exact user clarification that superseded the reference-SDK work:

```text
the runtime stuffs...you do...

dont use references for the issues you found...after that for sdk improvement we will use references not now
```

### Exact delegated worker task

```text
Runtime fix chunk 2. You own only these files: src-tauri/src/commands/ai_commands.rs, src-tauri/src/sdk/agent.rs, src-tauri/src/sdk/transport/http.rs. Implement runtime lifecycle fixes: prevent overlapping runs per session, make cleanup robust when channel sends fail, persist/honor session history more safely in ai_commands, improve cancellation so Stop can interrupt waits/stream reads/tool execution more promptly, and reduce runaway retry/iteration behavior to saner bounds. You are not alone in the codebase; do not revert others' edits, and accommodate concurrent changes. Use apply_patch for edits. Return a concise summary and list changed files.
```

## What I Was Working On

I was fixing the runtime-layer findings only, without using the cloned SDK references yet.

Main targets:

- stop overlapping runs from corrupting the same session
- make run cleanup happen even if the frontend channel drops
- make backend history handling prefer structured stored history over lossy replay
- improve cancellation so it interrupts waits/stream-open/stream-read paths sooner
- reduce runaway runtime behavior

## What I Already Did

### `src-tauri/src/commands/ai_commands.rs`

Partial runtime changes were made:

- added `ActiveRunRegistry`
- changed active-run tracking from `HashMap<String, AgentRunHandle>` to:
  - `request_runs`
  - `session_runs`
- started converting commands to use `State<'_, AIService>` instead of the old global `AI_SERVICE` lazy singleton
- updated `cancel_ai_stream()` to read from the new registry structure
- changed history hydration logic to:
  - prefer stored session history when present
  - only use provided `history_messages` when stored history is empty
  - preload that provided history into the session store if needed
- added same-session active-run checks before registration
- refactored `process_ai_stream()` so stream handling runs inside an inner async block and `cleanup_run()` happens afterward
- changed cancelled runs to persist retained partial messages before returning

Important note:

- this file is only partially transitioned and depends on `AIService`/session-store work from the other runtime chunk
- it currently assumes `AIService` is managed in Tauri state

### `src-tauri/src/sdk/agent.rs`

Partial runtime changes were made:

- reduced:
  - `DEFAULT_MAX_ITERATIONS` from `3000` to `80`
  - `MAX_CONSECUTIVE_SELF_CORRECTIONS` from `10` to `3`
  - `STREAM_OPEN_TIMEOUT_SECONDS` from `200` to `90`
  - `MULTIMODAL_COMPLETION_TIMEOUT_SECONDS` from `200` to `90`
- added `wait_for_cancellation(...)`
- patched the multimodal completion path so cancellation can interrupt the wait
- patched the stream-open path so cancellation can interrupt stream-open waits
- began converting the streaming loop to `tokio::select!`-based cancellation checks

Important note:

- the tool-execution portion was not finished when the turn was interrupted
- transport retry behavior was not finished either

### `src-tauri/src/sdk/transport/http.rs`

No real lifecycle fix was completed here yet.

Current status:

- only formatting-level diff noise is present
- retry delays / retry count were not actually changed yet

## What I Planned To Do Next

If I had continued immediately, next steps were:

1. Finish `agent.rs`
   - patch the tool execution phase to use cancellation-aware `tokio::select!`
   - ensure `stream.next()` is cancellation-aware throughout the streaming loop
   - review whether the existing `timeout(...)` import is still needed after the changes

2. Finish `ai_commands.rs`
   - verify all early-return paths still unregister active runs
   - add/finish helper functions:
     - `active_request_for_session(...)`
     - `register_active_run(...)`
     - `cleanup_run(...)`
   - verify `State<'_, AIService>` usage matches the actual `lib.rs` / `ai_service.rs` shape after the other runtime chunk lands

3. Update `http.rs`
   - shorten `RETRY_DELAY_MS`
   - lower the effective default retry aggressiveness
   - keep behavior sane enough that backend retries do not look like infinite “thinking”

4. Run verification
   - `cargo check`
   - fix compile breaks caused by integration with the session/AIService chunk

## What Still Needs To Be Done

- finish cancellation-safe tool execution in [src-tauri/src/sdk/agent.rs](src-tauri/src/sdk/agent.rs)
- finish cancellation-safe stream loop behavior in [src-tauri/src/sdk/agent.rs](src-tauri/src/sdk/agent.rs)
- complete and verify active-run helper functions in [src-tauri/src/commands/ai_commands.rs](src-tauri/src/commands/ai_commands.rs)
- ensure same-session overlap prevention works end-to-end in [src-tauri/src/commands/ai_commands.rs](src-tauri/src/commands/ai_commands.rs)
- actually reduce backend retry behavior in [src-tauri/src/sdk/transport/http.rs](src-tauri/src/sdk/transport/http.rs)
- run `cargo check`

## Current Risks / Integration Notes

- `ai_commands.rs` now partially expects `AIService` to come from Tauri state. If the other runtime chunk is not merged with matching `lib.rs` + `ai_service.rs` changes, this file will not compile.
- `agent.rs` is mid-refactor. The top-level constants and some cancellation helpers are already changed, but not all runtime paths are consistently patched.
- `http.rs` still needs the intended behavioral change; right now it should be treated as unfinished.
- I did not run `cargo check` after these partial edits.

## Files Touched In This Interrupted Runtime Chunk

- `src-tauri/src/commands/ai_commands.rs`
- `src-tauri/src/sdk/agent.rs`
- `src-tauri/src/sdk/transport/http.rs`

## Short Status Summary

This runtime chunk was interrupted mid-refactor.

- `ai_commands.rs`: partially advanced
- `agent.rs`: partially advanced
- `http.rs`: not meaningfully advanced yet
- verification: not run
