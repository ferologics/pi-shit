# AGENTS.md - pi-shit context

Combined Pi package repo. This repo is an integration layer over downstream sources.

## Source repos

- `extensions/` is synced from `~/dev/pi-extensions` (git subtree)
- `skills/` is synced from `~/dev/pi-skills` (git subtree)
- `themes/` is synced from `zenobi-us/pi-rose-pine`

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
