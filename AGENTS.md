# AGENTS.md - pi-shit context

Combined Pi package repo. This repo is an integration layer over downstream sources.

## Source repos

- `extensions/` is synced from `~/dev/pi-extensions` (git subtree)
- `skills/` is synced from `~/dev/pi-skills` (git subtree)
- `themes/` is synced from `zenobi-us/pi-rose-pine`

## Subtree sync policy (important)

Treat this repo as an integration layer with a **one-directional sync**:

- Source of truth for skills is `~/dev/pi-skills`.
- Source of truth for extensions is `~/dev/pi-extensions`.
- Pull downstream updates into this repo via `just update-skills` / `just update-extensions` (or `just update`).
- Avoid making direct long-term changes inside `skills/` or `extensions/` here.

If a change is made in `pi-shit/skills` or `pi-shit/extensions` by mistake:

1. Port that change to the upstream source repo first and commit/push there.
2. Run the corresponding `just update-*` in `pi-shit` to re-sync.
3. Only use `git subtree push` as a repair tool, not normal workflow.

## Backlog routing (important)

- Root `TODO.md` is for **pi-shit package-level integration** tasks only.
- Extension-specific backlog lives in `extensions/<extension>/TODO.md`.
- Skill-specific backlog lives in `skills/<skill>/TODO.md`.
- `extensions/TODO.md` is an index/shared file, not a single-extension backlog dump.
- When working directly in downstream source repos, keep the same TODO files aligned there.

## Checks

```bash
just check
```

Runs:

- Root markdown formatting (`dprint fmt --staged --allow-no-files`)
- Full extensions check (`just --justfile extensions/justfile check`)
