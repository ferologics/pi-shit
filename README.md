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

## Sync workflow

Primary flow (monorepo-first): edit in this repo, then publish mirrors.

```bash
just publish
```

`just publish` fans out to:

- `skills/` → `pi-skills`
- `extensions/` → `pi-extensions`
- `extensions/pi-notify/` → `pi-notify`

Or publish individually:

```bash
just publish-skills
just publish-extensions
just publish-pi-notify
```

Repair flow for one-off direct edits in downstream mirrors:

```bash
just update-skills
just update-extensions
just update-pi-notify
```

Theme sync still pulls from `zenobi-us/pi-rose-pine`:

```bash
just update-themes
```

`just update` runs all pulls (`update-skills`, `update-extensions`, `update-themes`) and regenerates the package manifest.

`update-extensions` includes `update-pi-notify`, so nested `pi-notify` updates are included automatically.
