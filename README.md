# pi-shit

Combined Pi package for personal extensions + skills.

## Structure

- `extensions/` → Pi extensions (for example `deep-review`, `pi-system-theme`, `plan-mode`)
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

## Sync workflow

Primary flow (monorepo-first): edit in this repo, then publish mirrors.

```bash
just publish
```

`just publish` fans out to:

- `skills/` → `pi-skills`
- `extensions/` → `pi-extensions`
- `extensions/deep-review/` → `pi-deep-review`
- `extensions/pi-notify/` → `pi-notify`
- `extensions/pi-system-theme/` → `pi-system-theme`

Or publish individually:

```bash
just publish-skills
just publish-extensions
just publish-pi-deep-review
just publish-pi-notify
just publish-pi-system-theme
```

Repair-only flow (use only for emergency downstream hotfixes; normal work should stay in `pi-shit`):

```bash
just update-skills
just update-extensions
just update-pi-deep-review
just update-pi-notify
just update-pi-system-theme
```

Theme sync still pulls from `zenobi-us/pi-rose-pine`:

```bash
just update-themes
```

`just update` runs all pulls (`update-skills`, `update-extensions`, `update-themes`) and regenerates the package manifest.

`update-extensions` includes `update-pi-deep-review`, `update-pi-notify`, and `update-pi-system-theme`, so nested mirror updates are included automatically.
