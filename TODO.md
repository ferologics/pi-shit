# TODO

## Backlog routing (source of truth)

- This file is for **pi-shit package-level integration** work only.
- Extension-specific backlog belongs in `extensions/<extension>/TODO.md` (source of truth in this repo).
  - Mirror path when published: `~/dev/pi-extensions/<extension>/TODO.md`
  - Some extensions also fan out to standalone mirrors (for example `~/dev/pi-deep-review/TODO.md`).
- Skill-specific backlog belongs in `skills/<skill>/TODO.md` (source of truth in this repo).
  - Mirror path when published: `~/dev/pi-skills/<skill>/TODO.md`
- `extensions/TODO.md` is an index/shared-extensions file, not a dumping ground for one extension.

## Downstream backlog index

- Extensions index: `extensions/TODO.md`
- Deep review backlog: `extensions/deep-review/TODO.md`
- Pi system theme backlog: `extensions/pi-system-theme/TODO.md`
- Plan mode backlog: `extensions/plan-mode/TODO.md`
- PR context packer backlog: `skills/pr-context-packer/TODO.md`

## Package-level integration backlog

- [x] Add release orchestration for monorepo + mirrors (version bump, tags, GitHub releases) with dry-run support.
- [ ] Extend release automation with optional changelog/release-note customization per package.
- [x] Add release-triggered npm publish workflows (`.github/workflows/npm-publish.yml`) for release targets.
- [ ] Configure npm Trusted Publishers (OIDC) in npm for each package/repo/workflow pair.

## Decide strategy for upstream Pi example extensions

We currently symlink these directly from the installed `pi-coding-agent` package:

- `~/.pi/agent/extensions/mac-system-theme.ts`
- `~/.pi/agent/extensions/notify.ts`
- `~/.pi/agent/extensions/question.ts`
- `~/.pi/agent/extensions/questionnaire.ts`
- `~/.pi/agent/extensions/subagent/index.ts`

### Questions to resolve

- [ ] Keep symlinking from upstream package (status quo), or vendor into `pi-shit/extensions/`?
- [ ] If we vendor: how do we track upstream updates (manual sync vs scripted sync)?
- [ ] Which should stay upstream-only vs become fully owned in `pi-shit`?
- [ ] Should `notify.ts` be replaced by local `pi-notify` entirely?
- [ ] Should `question.ts`, `questionnaire.ts`, `subagent` come from `pi-shit` instead of `~/.pi/agent/extensions/*` symlinks?

### Exit criteria

- [ ] Single documented source of truth for each extension in `~/.pi/agent/extensions/`
- [ ] Update workflow documented in dotfiles `justfile` and `AGENTS.md`
- [ ] No ambiguous “sometimes upstream, sometimes local” setup
