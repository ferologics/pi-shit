# pi-shit

Combined Pi package for personal extensions + skills.

## Structure

- `extensions/` → Pi extensions (for example `deep-review`, `plan-mode`)
- `skills/` → Pi skills (including `pr-context-packer`)
- `themes/` → Pi themes (`rose-pine`, `rose-pine-dawn`)

## Install in Pi

```bash
pi install npm:pi-shit
```

Or from git/local:

```bash
pi install git:github.com/ferologics/pi-shit
pi install /path/to/pi-shit
```

## Sync

This repo is assembled from:

- `skills/` ← `pi-skills` (git subtree)
- `extensions/` ← `pi-extensions` (git subtree)
- `themes/` ← `zenobi-us/pi-rose-pine` (via `just update-themes`)

Update all sources with:

```bash
just update
```

Or update individually:

```bash
just update-skills
just update-extensions
just update-themes
```
