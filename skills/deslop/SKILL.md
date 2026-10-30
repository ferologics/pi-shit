---
name: deslop
description: Strip needless complexity from your own diff before handing it off, such as single-use abstractions, unused options, special cases, duplicated logic, guards nothing reaches, narrating comments, and drive-by edits. Use after implementing a code change, before reporting it done.
---

# Deslop

Run this on the change you just made, before you report it done. Agents add code by default and rarely take it out: helpers with one caller, options nobody sets, special cases instead of a fix to the mechanism. This pass takes it out.

## Rules

- Scope is your change: the uncommitted diff, or the branch diff since the task started. Leave pre-existing code alone and mention problems there in the report.
- Only remove code, revert it, or replace it with an existing helper or path. When you delete a helper, inline it at its single call site. Anything that needs new code goes in the report.
- Keep an item only with evidence you can point at (`file:line`). If you can't point at any, remove it.
- Don't change behavior someone could rely on. When removing an item would, report it instead.

## 1. Inventory

Before editing, list every item of these kinds that the diff adds, with `file:line`:

1. **New abstractions**: functions, types, classes, modules, interfaces, wrappers, config objects. Count call sites and implementations. Inline a one-caller helper with no domain meaning. Remove a seam with a single implementation. Delete a wrapper that only forwards.
2. **New parameters, options, flags, config keys**: keep one only if some caller passes a non-default value.
3. **Special cases**: branches keyed to one caller, value, or hardcoded string, especially in shared code, and code that goes around an existing mechanism instead of through it. Don't fix these here. Report each with the change to the mechanism, or the existing path, that would remove it.
4. **Duplicates**: logic that repeats a helper or path the codebase already has. Search before deciding. Switch to the existing one when the switch stays inside your diff; otherwise report it.
5. **Guards**: try/catch, null checks, defaults, and retries. Keep one only if you can name the caller, input, or external system that produces the case, or it sits at a boundary where the repo handles failures (user input, network, files, external APIs).
6. **Extra output**: logs, metrics, comments, docstrings. Keep logs and metrics the task asked for or the repo requires there. Keep comments that state a non-obvious why. Remove comments that narrate the code, the change, or the task.
7. **Type escapes**: `any`, casts, non-null assertions, and ignore pragmas added to silence errors. Fix the type when the fix is local; otherwise report it.
8. **Tests you added**: remove tests that mirror the implementation, assert only on mocks, or cover inputs that can't occur. Keep tests that fail when the behavior is reverted.
9. **Drive-by edits**: formatting, renames, reordering, and refactors the task didn't need. Revert them.
10. **Orphans**: imports, variables, functions, files, and fixtures your change left unused. Delete them.

## 2. Apply

Remove and revert what failed its check. Run the checks the task already used (build, tests, lint). If something breaks, the code was load-bearing: restore it and note the evidence you missed.

## 3. Report

- Removed: one line per item (`file:line`, what), plus the net line change.
- Kept, where the reason isn't obvious: the item and its evidence.
- For the user: special cases with the deeper fix, removals held back because they change behavior, and problems outside your diff. One line each.
- What the change now does, in two or three plain sentences.
