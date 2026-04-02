# VISION

This extension should become `/pro`: a generic, branch-scoped ChatGPT Pro consultation workflow for Pi.

## Core idea

`/pro` is a side-thread primitive, not a planning feature.

It should let the user:

1. branch sideways from the current conversation
2. build a bespoke Pro bundle for the current question
3. manually hand that bundle to ChatGPT Pro
4. import the response back into the side-thread
5. iterate for multiple passes if needed
6. return to the original branch with a clean takeaway

Planning is one use case.
Review, architecture analysis, debugging, and freeform “think hard about this” consultations are equally valid use cases.

## Principles

- Stay in the same Pi session.
- Keep raw outbound artifacts on disk, not in Pi context.
- Make context selection explicit and composable.
- Prefer honest primitives over fake magic.
- Treat planning as a light preset, not the core ontology.
- Keep the manual handoff flow as the stable V1 backend.

## Near-term target

Keep evolving the current `/pro` implementation without losing the mechanics that already work:

- origin-anchor capture
- side-thread run state
- artifact-family snapshots
- manual submit/import flow
- one pending import at a time
- return-to-origin handoff

## Longer-term target

Once the generic `/pro` workflow is stable:

- add richer context selectors such as changed files and diffs
- add reusable intent presets
- optionally layer convenience automation on top of the same artifact flow

The long-term goal is a durable Pro side-thread primitive that can survive changes in prompts, use cases, and transport details.
