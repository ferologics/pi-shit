# AGENTS.md - pi-shit context

Combined Pi package repo. This repo is the monorepo source of truth for skills/extensions, and mirrors them to downstream repos.

## Mirror repos

- `extensions/` is mirrored to `~/dev/pi-extensions` (git subtree)
- `skills/` is mirrored to `~/dev/pi-skills` (git subtree)
- `themes/` is synced from `zenobi-us/pi-rose-pine`

## Subtree sync policy (important)

Use a **one-directional monorepo-first flow**:

- Do day-to-day edits in this repo (`skills/` and `extensions/`).
- Publish downstream mirrors with:
  - `just publish-skills`
  - `just publish-extensions`
  - `just publish` (both)

`just update-skills` / `just update-extensions` are **repair-only** for one-off direct downstream edits.

If you make a one-off downstream edit directly in `~/dev/pi-skills` or `~/dev/pi-extensions`:

1. Commit/push downstream.
2. Run the matching `just update-*` in this repo.
3. Continue normal work from `pi-shit`.

## Backlog routing (important)

- Root `TODO.md` is for **pi-shit package-level integration** tasks only.
- Extension-specific backlog lives in `extensions/<extension>/TODO.md`.
- Skill-specific backlog lives in `skills/<skill>/TODO.md`.
- `extensions/TODO.md` is an index/shared file, not a single-extension backlog dump.
- Keep backlog files aligned with downstream mirrors via subtree publish/sync.

## Checks

```bash
just check
```

Runs:

- Root markdown formatting (`dprint fmt --staged --allow-no-files`)
- Full extensions check (`just --justfile extensions/justfile check`)
