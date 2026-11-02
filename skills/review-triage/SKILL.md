---
name: review-triage
description: Triage code review findings before changing code. Verify each one, separate the symptom from the proposed fix, and let the user pick what to fix. Use when acting on review findings from a reviewer agent or PR comments.
---

# Review Triage

Treat review findings as claims, not tasks. Reviewers usually spot a real symptom but often guess the wrong cause, and a proposed fix applied as written turns into code nobody asked for. Triage first, then fix only what the user picks.

## Triage (no repo edits)

Work through every finding. Put scratch reproductions in a temp directory, not the repo.

1. **Symptom.** Restate it in one line: what goes wrong, for which input or state. Set the reviewer's proposed fix and suggestion code aside; treat it as a hypothesis.
2. **Evidence.** Read the code and settle it:
   - `confirmed`: the caller, input, or state that triggers it (`file:line`), a failing command or test, or the quoted requirement it breaks.
   - `refuted`: where it is already handled, why the input can't occur, or where the behavior is intended.
   - `unverified`: what would settle it.

   "Unlikely" or "looks fine" is not a refutation. Mark those `unverified`.
3. **Cause.** Name where the fix belongs. If the flagged line is only where the symptom shows and the cause sits upstream (a wrong producer, a missing invariant, an existing path the change went around), say so.
4. **Directions.** One to three, smallest first, each with a rough size (files, lines). Check these before anything that adds code:
   - delete or revert the code that causes it
   - change the mechanism once instead of adding a special case
   - route through the existing path the change bypassed

   A direction that adds a guard, fallback, retry, option, or special case must name the input that reaches it.
5. **Call.** `fix` (with the direction you recommend), `ask` (needs the user's decision), or `skip`.

Default to `skip` for test or coverage requests that don't pin a confirmed defect, hardening against inputs the types or callers already exclude, style or alternative designs without a repo rule behind them, and "consider" or "might" findings with no triggering input.

Output one table, ordered by priority. Re-rank by what you verified, and leave refuted findings out of it:

| # | Priority | Symptom | Verdict and evidence | Cause | Call |
| - | -------- | ------- | -------------------- | ----- | ---- |

Below it, give the directions for each `fix` and `ask` row in one to three lines, then list the refuted findings, one line each with the evidence. Then stop and wait for the user to pick. Do not start fixing, even when every call looks obvious.
