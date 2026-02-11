# AGENTS.md - pi-shit context

Combined Pi package repo. This repo is the monorepo source of truth for skills/extensions, and mirrors them to downstream repos.

## Mirror repos

- `extensions/` is mirrored to `~/dev/pi-extensions` (git subtree)
- `extensions/pi-notify/` is also mirrored to `~/dev/pi-notify` (nested subtree fan-out)
- `extensions/pi-system-theme/` is also mirrored to `~/dev/pi-system-theme` (nested subtree fan-out)
- `skills/` is mirrored to `~/dev/pi-skills` (git subtree)
- `themes/` is synced from `zenobi-us/pi-rose-pine`

## Subtree sync policy (important)

Use a **one-directional monorepo-first flow**:

- Do day-to-day edits in this repo (`skills/` and `extensions/`).
- Publish downstream mirrors with:
  - `just publish-skills`
  - `just publish-extensions`
  - `just publish-pi-notify`
  - `just publish-pi-system-theme`
  - `just publish` (all mirrors)

`just update-skills` / `just update-extensions` / `just update-pi-notify` / `just update-pi-system-theme` are **repair-only** for one-off direct downstream edits.

`just update-extensions` also runs `update-pi-notify` and `update-pi-system-theme` so nested mirror changes are pulled too.

If you make a one-off downstream edit directly in `~/dev/pi-skills`, `~/dev/pi-extensions`, `~/dev/pi-notify`, or `~/dev/pi-system-theme`:

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

- Root markdown formatting (`dprint fmt`)
- Skills check (`just --justfile skills/justfile check`)
- Full extensions check (`just --justfile extensions/justfile check`)
