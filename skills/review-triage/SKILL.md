---
name: review-triage
description: Triage code review findings before changing code. Verify each one, separate the symptom from the proposed fix, and let the user pick what to fix. Use when acting on review findings from /review, a reviewer agent, or PR comments.
---

# Review Triage

Treat review findings as claims, not tasks. Reviewers usually spot a real symptom but often guess the wrong cause, and a proposed fix applied as written turns into code nobody asked for. Triage first, then fix only what the user picks.

## 1. Triage (no repo edits)

Work through every finding. Put scratch reproductions in a temp directory, not the repo. When the reviewer already backed a finding with evidence, check that evidence instead of starting over.

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

Output one table, rows ordered fix, ask, skip:

| # | Symptom | Verdict and evidence | Cause | Call |
| - | ------- | -------------------- | ----- | ---- |

Below it, give the directions for each `fix` and `ask` row in one to three lines. Then stop and wait for the user to pick. Do not start fixing, even when every call looks obvious.

## 2. Fix what the user picked

- Fix one finding at a time, in the direction the user picked.
- The spec is the one-line symptom plus that direction, not the review text.
- Stay within the size from triage. If the fix outgrows it, or the cause turns out to be elsewhere, stop and report before going further.
- No adjacent cleanup, refactors, or extra hardening.
- Show a correctness fix failing before and passing after when it can be reproduced, with the repo's existing test style for that area or a command. Then run the relevant checks.
- Report per finding: files and net lines changed, the proof, and anything skipped with the reason.

Don't ask for another full review afterwards. For a recheck, review only the fix diff against the accepted findings.

## Declined findings

When a finding is refuted for a reason a future reviewer would need (intended behavior, an accepted risk, a constraint), offer one line for the repo's `REVIEW_GUIDELINES.md` (next to its `.pi/` directory, where pi-review reads it) so the finding doesn't come back. Offer it; don't write it.
