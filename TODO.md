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

## Deep-review: add ChatGPT Codex backend path support

Goal: allow `/deep-review` to run with ChatGPT Plus/Pro OAuth (openai-codex) by supporting the Codex responses endpoint in addition to OpenAI Platform API.

### TODO

- [ ] Add dual-path request logic in `extensions/deep-review/index.ts`:
    - Platform API path: `https://api.openai.com/v1/responses`
    - Codex subscription path: `https://chatgpt.com/backend-api/codex/responses`
- [ ] Auto-detect token/source and pick endpoint + headers accordingly
- [ ] Keep current Platform API behavior fully intact
- [ ] Validate parameter compatibility across both paths (effort/summary/verbosity/model IDs)
- [ ] Decide whether Codex path should become default when OAuth token is present
- [ ] Add docs to `extensions/deep-review/README.md` for auth + endpoint routing behavior
- [ ] Add smoke tests for both auth modes (API key + OAuth)

### Exit criteria

- [ ] `/deep-review` works with either:
    - `OPENAI_API_KEY` (Platform)
    - `openai-codex` OAuth credentials from `~/.pi/agent/auth.json`
- [ ] No regression in output format, cost reporting, or debug artifacts
- [ ] Clear failure messages when selected auth/token cannot access selected endpoint
