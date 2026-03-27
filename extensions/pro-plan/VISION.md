# VISION

`pro-plan` should make ChatGPT Pro feel native inside Pi without turning planning into a rigid wizard.

## Principles

- Planning stays human-driven and interactive.
- Pi owns the workflow, branching, artifacts, and handoff.
- The Pro backend is replaceable.
- Raw request payloads live on disk, not in session context.
- Code context is explicit first, smarter later.

## Near-term target

A reliable same-session planning branch workflow:

1. Start planning from the current session state
2. Iterate normally with Pi
3. Run one or more Pro passes with optional code context
4. Bring useful Pro output back into the planning branch
5. Return to the origin anchor and begin implementation with a clean handoff

## Longer-term target

Swap the Oracle dependency for a native Pro runner while keeping the same `/pro-plan` UX.
