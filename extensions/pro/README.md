# Pro

Manual ChatGPT Pro side-thread workflow for Pi.

See also:

- [`ARCHITECTURE.md`](./ARCHITECTURE.md)
- [`MIGRATION.md`](./MIGRATION.md)
- [`VISION.md`](./VISION.md)
- [`TODO.md`](./TODO.md)

## What exists today

- Starts a side-thread from the current session state
- Keeps the consultation interactive inside Pi
- Prepares optional ChatGPT Pro submission bundles for manual upload or paste
- Imports copied ChatGPT responses back into the side-thread
- Stores request / pack / submit / response / metadata artifacts on disk
- Returns to the origin anchor and prefills the editor with the latest imported takeaway

## Current commands

Primary commands:

- `/pro start`
- `/pro pass [prompt] [--intent <general|plan|review|architecture|debug|analyze>] [--transcript <origin|last-import|none>] [--path <file|dir|glob>] [--changed [<ref>]] [--diff [<ref>]] [--reuse-context] [--budget <tokens>] [--include-dependents] [--include-docs] [--include-tests] [--no-code]`
- `/pro import [response-file]`
- `/pro return`
- `/pro status`
- `/pro stop`

## Current notes

- `/pro pass` prepares a single submission bundle for a fresh ChatGPT Pro chat.
- `--intent` is a light preset for the pass request shape.
- `--transcript` controls whether the pass sees the side-thread from `origin`, only since `last-import`, or `none`.
- `/pro pass` and `/pro import` only work while you are still on the active `/pro` side-thread; if you navigate away, they refuse instead of silently following the current branch.
- The bundle is written to disk, copied to the clipboard, and revealed in Finder so you can paste it or drag the file into ChatGPT.
- `/pro pass` reports whether clipboard copy and Finder reveal actually succeeded.
- `/pro import` reads the clipboard by default; provide a file path only when importing a saved response file.
- `/pro status` renders a markdown status snapshot, including pending-import details and off-branch warnings.
- Code context is explicit in V1: pass `--path`, `--changed`, and/or `--diff` when you want repo context packed for Pro.
- Stored context is only reused when you pass `--reuse-context`.
- If no code source flags are given, the pass is transcript-only.
- Request/context-pack payloads stay on disk instead of being injected into Pi context.

## Current artifacts

Artifacts are currently written under:

```text
~/.pi/agent/pro/
```

Typical files per pass share one artifact-family prefix:

- `pass-001-<timestamp>.request.md`
- `pass-001-<timestamp>.pack.md` (optional)
- `pass-001-<timestamp>.submit.md`
- `pass-001-<timestamp>.response.md`
- `pass-001-<timestamp>.meta.json`

Plus:

- `state.json` at the run root

That shared prefix makes each pass snapshot easy to inspect as a single family.

## Recommended local tools

- macOS clipboard + Finder integration (`pbcopy`, `pbpaste`, `open`) for the smoothest manual handoff
- `tokencount` for better token estimates
- `npx @sibyllinesoft/scribe@1.0.4` available for related-file expansion
