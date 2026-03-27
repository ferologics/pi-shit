# Pro Plan

Planning workflow extension for Pi that keeps planning in the current session, checkpoints Pro passes on disk, and uses Oracle as the V1 ChatGPT Pro transport.

## What it does

- Starts a planning branch from the current session state
- Keeps planning interactive inside Pi
- Runs optional Pro passes via Oracle browser mode
- Stores request / response / log / metadata artifacts on disk
- Returns to the origin anchor and prefills the editor with the finalized plan

## Commands

- `/pro-plan start`
- `/pro-plan pass [prompt] [--path <file|dir|glob>] [--budget <tokens>] [--include-dependents] [--include-docs] [--include-tests] [--no-code]`
- `/pro-plan final [same options as pass]`
- `/pro-plan apply`
- `/pro-plan status`
- `/pro-plan stop`

## Notes

- V1 uses Oracle only as the Pro execution backend.
- Code context is explicit in V1: pass `--path` specs when you want code packed for Pro.
- If no `--path` specs are given, the pass is planning-only.
- Request/context-pack payloads stay on disk instead of being injected into Pi context.

## Requirements

Recommended:

- `oracle` on PATH, or `npx` available so the extension can run `@steipete/oracle`
- `tokencount` for better token estimates
- `npx @sibyllinesoft/scribe@1.0.4` available for related-file expansion

## Artifacts

Artifacts are written under:

```text
~/.pi/agent/pro-plan/
```

Typical files per pass:

- `pass-001.request.md`
- `pass-001.pack.md` (optional)
- `pass-001.response.md`
- `pass-001.oracle.log`
- `pass-001.meta.json`

Finalized planning can later be applied back to the origin anchor with `/pro-plan apply`.
