# TODO

## Current priority

Continue refining `/pro` as a generic side-thread consultation workflow.

See also:

- `ARCHITECTURE.md`
- `MIGRATION.md`

## Migration backlog

### Rename and de-planify

- [x] Add `/pro` as the primary command.
- [x] Remove `/pro-plan` compatibility aliasing.
- [x] Rename `apply` to `return`.
- [x] Remove `final` as a first-class command.
- [x] Rename planning-specific UI strings and message types to generic `pro-*` names.

### Genericize the core model

- [x] Replace planning-specific transcript wording with generic side-thread/Pro wording.
- [x] Replace planning-specific request rendering with generic pass bundle rendering.
- [x] Replace the final-plan handoff wrapper with a neutral `/pro` takeaway wrapper.
- [x] Remove planning-only state concepts that do not belong in the generic core.

### Explicit context selection

- [x] Add `--intent` as a light preset selector.
- [x] Add `--transcript <origin|last-import|none>`.
- [x] Add `--reuse-context`.
- [x] Stop silently reusing prior path seeds by default.
- [x] Persist requested and resolved context selection in `meta.json`.

### Richer source selectors

- [x] Add `--changed [<ref>]`.
- [x] Add `--diff [<ref>]`.
- [x] Keep expansion (`dependents`, `docs`, `tests`, Scribe) downstream of explicit selection.

### Module cleanup

- [x] Split command handlers into generic modules such as `workflow.ts`, `transcript.ts`, `bundle.ts`, and `presets.ts`.
- [x] Rename `extensions/pro-plan/` to `extensions/pro/`.
- [x] Keep generated review bundles outside the repo source tree.

### Hardening and UX

- [x] Add markdown renderers for help / result / error messages.
- [x] Move `/pro status` to a markdown status message.
- [x] Refuse `/pro pass` and `/pro import` when the user is off the active `/pro` side-thread.
- [x] Add workflow tests for start / pass / import / return, wrong-branch refusal, and state restoration.
