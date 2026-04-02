# MIGRATION

This file describes the recommended migration from the old `/pro-plan` prototype to the generic `/pro` workflow.

## Principle

Keep the mechanics.
Delete the planning ontology.

Do not rewrite the extension from scratch.
Refactor in phases, preserving the parts that are already correct:

- same-session side-thread behavior
- artifact-family snapshots
- manual handoff transport
- clipboard-default import
- pending-import guard
- return-to-origin workflow

## Phase 1 — docs and target architecture

Goal: establish the target model before changing code.

- [x] Write a generic `/pro` architecture document
- [x] Rewrite the extension vision around branch-scoped Pro consultation
- [x] Rewrite the extension backlog around `/pro`
- [x] Replace the narrow manual-handoff planning writeup with the new architecture target
- [ ] Decide whether generated review bundles should remain tracked or move entirely to ignored artifact space

## Phase 2 — rename and de-planify without changing successful mechanics

Goal: rename the concept first, while keeping the working run/pass/import flow.

- [x] Add `/pro` as the primary command
- [x] Remove `/pro-plan` command aliasing
- [x] Rename user-facing strings and status text from planning-specific to generic Pro wording
- [x] Rename `apply` to `return`
- [x] Remove `final` as a first-class subcommand
- [x] Rename planning-specific custom message types to generic `pro-*` names

## Phase 3 — genericize the core types and renderers

Goal: remove planning-specific concepts from the core code and state model.

- [x] Rename `ProPlanState` -> `ProRunState`
- [x] Rename `ProPlanPassOptions` -> `ProPassOptions`
- [x] Remove `ProPlanMode`
- [x] Remove `latestMode`
- [x] Remove `finalResponsePath`
- [x] Replace planning-specific transcript headings with generic branch/Pro wording
- [x] Replace planning-specific request builders with generic pass bundle renderers
- [x] Replace planning-specific return wrapper with a neutral `/pro` takeaway wrapper

## Phase 4 — introduce the explicit context selection model

Goal: make context selection honest, composable, and generic.

- [x] Add `--intent`
- [x] Add `--transcript`
- [x] Add `--reuse-context`
- [x] Stop silently inheriting prior path seeds by default
- [x] Persist the last selection only as an optional convenience
- [x] Record requested vs resolved context in `meta.json`
- [x] Add a generic `ContextSelection` model to the type system
- [x] Track `lastImportEntryId` so transcript slicing can target `last-import`

## Phase 5 — add richer source selectors

Goal: widen context sourcing without changing the core model.

- [x] Add `--changed [<ref>]`
- [x] Add `--diff [<ref>]`
- [x] Treat changed-file full contents as another generic file-pack source
- [x] Treat diff hunks as a separate source kind in bundle rendering
- [x] Keep expansion (`dependents`, `docs`, `tests`, Scribe) downstream of explicit selection

## Phase 6 — module cleanup

Goal: split the oversized command implementation into cleaner generic modules.

Target shape:

```text
extensions/pro/
├── index.ts
├── workflow.ts
├── args.ts
├── types.ts
├── artifacts.ts
├── transcript.ts
├── bundle.ts
├── context-pack.ts
├── presets.ts
├── manual.ts
├── README.md
├── ARCHITECTURE.md
└── TODO.md
```

Checklist:

- [x] Rename `extensions/pro-plan/` -> `extensions/pro/`
- [x] Create `workflow.ts`
- [x] Create `transcript.ts`
- [x] Create `bundle.ts`
- [x] Create `presets.ts`
- [x] Keep `artifacts.ts`, `manual.ts`, and `context-pack.ts`, but genericize their names/usages
- [x] Leave `oracle.ts` deleted

## Phase 7 — compatibility cleanup

Goal: remove remaining transitional planning-era compatibility once `/pro` has settled.

- [x] Delete the `/pro-plan` compatibility shim
- [x] Remove planning-named custom message compatibility
- [x] Rename artifact root from `pro-plan` to `pro`
- [ ] Refresh any remaining historical maintainer docs as needed

## Immediate next implementation slice

Recommended next code slice:

1. simplify the overlapping run/default/selection state model
2. decide whether to extract a small shared context-pack core or own a smaller local `/pro` packer
3. trim transcript noise and tighten broad directory/glob traversal

That keeps the remaining work focused on making `/pro` smaller and more reliable rather than broader.
