# ARCHITECTURE

## Goal

This extension should evolve into `/pro`: a generic, branch-scoped ChatGPT Pro consultation workflow for Pi.

The stable primitive is not planning.
The stable primitive is:

- branch sideways from the current conversation
- build a bespoke prompt + context bundle
- hand that bundle to ChatGPT Pro manually
- import the response back into the side branch
- iterate for more passes if needed
- return to the original branch with a clean takeaway

Planning is one preset on top of that workflow, not the workflow itself.

## Current status

Today, the implementation lives under `extensions/pro/`, and the primary command surface is `/pro`.

The architecture target documented here is the generic `/pro` model that the implementation is being migrated toward.

## Core workflow model

The generic workflow is a same-session side-thread consultation run:

1. Start a run from the current leaf in the current Pi session
2. Capture the origin anchor
3. Work in a side-thread inside the same session
4. Prepare a Pro submission bundle for a pass
5. Manually submit it to a fresh ChatGPT Pro chat
6. Import the response back into the side-thread
7. Repeat passes as needed
8. Return to the origin anchor with a clean takeaway

## Target command model

Target command surface:

- `/pro start`
- `/pro pass [prompt] [options]`
- `/pro import [response-file]`
- `/pro return`
- `/pro status`
- `/pro stop`

Recommended `pass` options:

- `--intent <general|plan|review|architecture|debug|analyze>`
- `--transcript <origin|last-import|none>`
- `--path <file|dir|glob>` (repeatable)
- `--changed [<ref>]`
- `--diff [<ref>]`
- `--include-dependents`
- `--include-docs`
- `--include-tests`
- `--budget <tokens>`
- `--reuse-context`

## Lifecycle

State machine:

- inactive
- active run
- pending import
- active run
- return or stop
- inactive

Detailed flow:

1. `/pro start`
   - capture the current leaf as the origin anchor
   - create the run artifact directory
   - activate the side-thread run
2. side-thread work in Pi
   - discuss, inspect, refine prompt/context
3. `/pro pass`
   - require the user to still be on the active `/pro` side-thread
   - snapshot the selected transcript
   - resolve explicit context sources
   - build request / pack / submit / meta artifacts
   - copy the submit bundle to the clipboard
   - reveal it for manual upload
   - report whether those convenience steps actually succeeded
   - mark one pending import
4. user submits the bundle to a fresh ChatGPT Pro chat
5. `/pro import`
   - require the user to still be on the active `/pro` side-thread
   - read clipboard by default
   - write the response artifact
   - append the imported response into the side branch
   - clear pending import
6. repeat `pass` / `import` as needed
7. `/pro return`
   - navigate back to the origin anchor
   - prefill the editor with a neutral takeaway wrapper
   - close the run
8. `/pro stop`
   - abandon the run
   - keep artifacts
   - do not return anything

## Context model

Context selection should be modeled as an explicit manifest, not a guess.

Suggested internal shape:

```ts
type TranscriptScope = "origin" | "last-import" | "none";

type ContextSource =
    | { kind: "paths"; specs: string[] }
    | { kind: "changed"; ref?: string }
    | { kind: "diff"; ref?: string };

interface ContextSelection {
    transcript: TranscriptScope;
    sources: ContextSource[];
    expansion: {
        dependents: boolean;
        docs: boolean;
        tests: boolean;
    };
    budget: number;
}
```

Important rule:

- selection and expansion are different things
- `paths`, `changed`, and `diff` are selection
- dependents/docs/tests/Scribe are expansion

The extension should never pretend it can always infer the right context automatically.
It should provide honest, composable context primitives.

## Intent model

Intent should be a light preset, not a first-class workflow mode.

Examples:

- `general`
- `plan`
- `review`
- `architecture`
- `debug`
- `analyze`

An intent preset may contribute:

- title wording
- instruction scaffold
- expected output shape

An intent preset should **not** change:

- run lifecycle
- artifact structure
- import semantics
- return semantics
- core context selection behavior

## Artifact model

The current artifact mechanics are already the right base and should survive the rename.

Per run:

- one run directory under the Pi agent area
- one `state.json` at the run root

Per pass:

- one shared artifact-family prefix
- `.request.md`
- optional `.pack.md`
- `.submit.md`
- `.response.md`
- `.meta.json`

`meta.json` should eventually record both:

- requested context selection
- resolved context result

That makes each pass auditable and reproducible.

## Generic core vs preset layer

### Generic core

The generic `/pro` core should own:

- run state machine
- origin anchor capture
- artifact store
- transcript snapshotting
- explicit context resolution
- bundle rendering
- manual clipboard/file handoff
- response import
- return-to-origin handoff

### Thin preset layer

Planning, review, debugging, and architecture should only contribute prompt scaffolding and output shape.

Examples of preset-specific wording:

- planning asks for phased implementation, risks, validation
- review asks for findings, severity, fixes
- debug asks for diagnosis, hypotheses, validation steps

That belongs in a preset layer, not in the workflow core.

## Non-goals

This architecture deliberately avoids:

- fake magic around context inference
- planning-specific lifecycle phases like `final`
- special-case “apply this plan” semantics in the core workflow
- browser automation as the foundation
- polluting Pi session context with raw outbound bundle artifacts

## Naming direction

As the implementation migrates, planning-specific names should disappear from the core model.

Examples:

- `/pro-plan` -> `/pro`
- `apply` -> `return`
- `ProPlanState` -> `ProRunState`
- planning-only message types -> generic `pro-*` message types

## Review bundles

Generated external-review bundles are useful, but they should be treated as generated artifacts, not source of truth.

They should live outside the repo, for example under `~/.pi/agent/pro/` during the current transition.
