# TODO

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
