---
name: arch-audit
description: Audit a codebase or subtree for architectural problems and incidental complexity, and rank simpler shapes for the user to pick from. Use when the user asks for an architecture audit.
disable-model-invocation: true
---

# Arch audit

A fresh-eyes audit of the design itself, not a review of a change. Find where the structure makes the code harder to change than the problem requires, and propose simpler shapes. Change nothing; the user picks what to pursue.

## Rules

- Read the intent first: AGENTS.md, README, VISION.md, TODO.md, architecture docs, and decision records (ADRs). Don't re-suggest something a decision record rejected unless the friction is real; name the record you're reopening and why.
- Separate necessary complexity (the problem is hard) from incidental complexity (the code made it hard).
- Respect Chesterton's fence. When something looks odd, look for its reason in `git log` and blame. If you still can't tell, list it under "Needs context" instead of calling it wrong.
- Back every finding with `file:line`. Say when you're unsure. Skip taste nitpicks.
- Read-only. No edits.

## 1. Scope

If the user named a target, audit that. Otherwise start where change concentrates, since a better structure pays off where code keeps changing:

```bash
git log --since="6 months ago" --name-only --format= | sort | uniq -c | sort -rn | head -30
```

For a large codebase, explore with subagents and keep their conclusions, not their transcripts. Say what you covered and what you skipped.

## 2. Look for

Picture the next contributor as an agent that sees only the files it opened, copies the nearest example, and takes the shortest path that compiles. Structures that mislead that contributor are the ones that rot.

- **Shallow modules and pass-through layers**: the interface is nearly as big as the implementation, or a layer forwards calls without adding policy. Deletion test: if deleting it makes the complexity vanish, it was a pass-through; if the complexity reappears in every caller, it earns its keep.
- **Seams with one implementation**: an interface, adapter, or plugin point with a single implementation and no second one in sight.
- **Split ownership**: more than one module writes the same state or encodes the same decision, so a change in one place silently disagrees with the others.
- **Two ways to do one task**: parallel paths for the same job. Each one keeps gaining callers.
- **Hand-synced lists**: adding an item means editing several places that nothing checks against each other.
- **Implicit state machines**: state spread across booleans, nullable fields, and status strings whose combinations are the real states, with transitions set from scattered handlers. For each one, list the states, where each transition happens, and the combinations the code can represent but should never reach.
- **Rules enforced only by convention**: things the code relies on in more than one place that nothing enforces, such as call order, "keep in sync" comments, or optional fields that are always set in practice. Report one only with the concrete way it breaks.
- **Tests that pin the design in place**: tests coupled to internals, or brittle, so the simpler shape can't land without rewriting them.

## 3. Report

Start with an overall assessment in one or two paragraphs: does the architecture make sense?

Then the candidates, strongest first. For each:

- **Files**: where it lives.
- **Problem**: the mechanism and what it costs (bugs, changes made in several places, a misled next contributor).
- **Evidence**: `file:line`.
- **Simpler shape**: in plain words, and what it would delete.
- **Strength**: `Strong`, `Worth exploring`, or `Speculative`.

Then **Needs context**: things that look wrong but may have a reason you couldn't find.

End with the one candidate you'd do first and why, then ask which to explore. Don't design interfaces or write code before the user picks.

## 4. Explore the pick

Work out the new shape with the user before any code: the constraints, what moves behind the new boundary, what gets deleted, and how it gets tested. When the right shape isn't obvious, sketch two or three structurally different ones and compare how much each hides behind how small an interface.

If the user rejects a candidate for a reason a future audit would need, offer to record it in the repo's decision records so it doesn't come back. Offer it; don't write it.
