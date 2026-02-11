# AGENTS.md - pi-shit context

Combined Pi package repo. This repo is the monorepo source of truth for skills/extensions, and mirrors them to downstream repos.

## Mirror repos

- `extensions/` is mirrored to `~/dev/pi-extensions` (git subtree)
- `extensions/deep-review/` is also mirrored to `~/dev/pi-deep-review` (nested subtree fan-out)
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
  - `just publish-pi-deep-review`
  - `just publish-pi-notify`
  - `just publish-pi-system-theme`
  - `just publish` (all mirrors)

Do **not** do normal development directly in downstream mirrors.

`just pull-skills` / `just pull-extensions` / `just pull-pi-deep-review` / `just pull-pi-notify` / `just pull-pi-system-theme` are **repair-only** for emergency one-off downstream edits.

`just pull-extensions` also runs `pull-pi-deep-review`, `pull-pi-notify`, and `pull-pi-system-theme` so nested mirror changes are pulled too.

If an emergency downstream hotfix is unavoidable in `~/dev/pi-skills`, `~/dev/pi-extensions`, `~/dev/pi-deep-review`, `~/dev/pi-notify`, or `~/dev/pi-system-theme`:

1. Commit/push downstream.
2. Run the matching `just pull-*` in this repo to pull it back.
3. Resume normal work from `pi-shit` only.

## Release workflow (important)

Use `just release` to orchestrate version bumps, mirror publish, npm publish, and GitHub releases.

- Dry-run first: `just release-dry deep-review minor`
- Then execute: `just release deep-review minor`

Target propagation rules:

- `deep-review`: `pi-deep-review` -> `@ferologics/pi-extensions` -> `pi-shit`
- `pi-notify`: `pi-notify` -> `@ferologics/pi-extensions` -> `pi-shit`
- `pi-system-theme`: `pi-system-theme` -> `@ferologics/pi-extensions` -> `pi-shit`
- `extensions`: `@ferologics/pi-extensions` -> `pi-shit`
- `pi-shit`: root only

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
