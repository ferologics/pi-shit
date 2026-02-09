---
name: multi-review
description: Multi-model code review. Runs code-review skill with 3 models in parallel, then synthesizes findings.
---

# Multi Review

Runs the `code-review` skill with 3 different models in parallel, then synthesizes with **active validation**.

## Process

### Phase 1: Gather Reviews

1. **Get the PR diff** (same as code-review)
   ```bash
   # If PR number provided, use it. Otherwise current branch.
   gh pr diff [PR_NUMBER] > /tmp/pr-diff.txt
   ```

2. **Run 3 parallel reviews via bash**
   ```bash
   pi -p --model claude-opus-4-5 "Read and follow ~/dev/pi-skills/code-review/SKILL.md to review the PR. Diff is at /tmp/pr-diff.txt" > /tmp/review-opus.md &
   pi -p --model gpt-5.2-codex "Read and follow ~/dev/pi-skills/code-review/SKILL.md to review the PR. Diff is at /tmp/pr-diff.txt" > /tmp/review-codex.md &
   pi -p --model gemini-2.5-pro "Read and follow ~/dev/pi-skills/code-review/SKILL.md to review the PR. Diff is at /tmp/pr-diff.txt" > /tmp/review-gemini.md &
   wait
   ```

### Phase 2: Active Validation (IMPORTANT)

**Do not blindly trust the reviewers. Validate each finding yourself.**

3. **Read PR context first**
   Before looking at sub-agent reviews, get the full picture:
   ```bash
   # What the PR claims to do
   gh pr view [PR_NUMBER] --json title,body
   
   # What it actually does
   cat /tmp/pr-diff.txt
   
   # What others have already said
   gh pr view [PR_NUMBER] --json comments,reviews --jq '.comments[].body, .reviews[].body'
   ```
   Form your own impressions. Note any issues already flagged in PR feedback.

4. **Collect all findings**
   Build a deduplicated list of every issue from all 3 reviews.
   Note which model(s) found each issue.

5. **Validate EACH finding**
   For every finding, actually look at the code and verify:
   - Is this a real bug/issue? (check the code, don't just trust the claim)
   - Is it a false positive? (model hallucinated or misunderstood)
   - What file/line is affected? (verify it exists and matches)

6. **Score by IMPACT, not consensus**
   Rate each validated issue by actual severity:
   - 🔴 **Critical**: Breaks functionality, security issue, data loss
   - 🟠 **High**: Real bugs, incorrect behavior, major guideline violations  
   - 🟡 **Medium**: Performance, maintainability, edge cases
   - 🟢 **Low**: Style, minor improvements, nitpicks

   **Consensus count (2+ models) ≠ importance.**
   - Consensus often means "obvious issue any reviewer would catch"
   - Unique findings may be subtle insights worth MORE attention, not less

7. **Flag unique findings for extra scrutiny**
   When only one model found something:
   - WHY did only one catch it? (deeper insight vs hallucination?)
   - Validate more carefully - could be the most important find
   - Could also be a false positive - verify against actual code

8. **Check for gaps**
   What might ALL models have missed?
   - Complex state/timing issues (e.g., async race conditions)
   - Claimed features that don't actually work (check PR description)
   - Subtle logic errors in control flow
   - Look at the PR description - are all claims implemented?

### Phase 3: Synthesized Output

9. **Output format**

```markdown
# 🔍 Multi-Model PR Review: [PR title]

## Validated Issues

### 🔴 Critical
[Issues that must be fixed - functionality broken, security, etc.]

### 🟠 High Priority  
[Real bugs, incorrect behavior - should fix before merge]

### 🟡 Medium Priority
[Performance, maintainability, edge cases - should discuss]

### 🟢 Low Priority
[Style, minor improvements - nice to have]

Each issue should include:
- **File**: path/to/file.ext#L10-L15
- **Status**: ✅ Confirmed | ⚠️ Needs verification | ❌ False positive
- **Found by**: Opus / Codex / Gemini / PR feedback
- **Description**: What's wrong and why it matters
- **Suggestion**: How to fix (if applicable)

## ❌ False Positives Filtered
[List any findings that were wrong, with brief explanation]

## ⚠️ Potential Gaps
[Things all models may have missed - especially check PR description claims]

## 📊 Model Coverage
| Issue | Opus | Codex | Gemini | PR | Status |
|-------|:----:|:-----:|:------:|:--:|--------|
| Issue 1 | ✅ | ✅ | ❌ | - | ✅ Confirmed |
| Issue 2 | ❌ | ✅ | ❌ | - | ✅ Confirmed |
| Issue 3 | ✅ | ❌ | ✅ | - | ❌ False positive |
| Issue 4 | ❌ | ❌ | ❌ | ✅ | ⚠️ Models missed! |

## Final Verdict
**[MERGE / FIX FIRST / NEEDS DISCUSSION]**

[Brief explanation of verdict]
```

## Key Principles

1. **Validate, don't just synthesize** - You are the senior reviewer, not a secretary
2. **Unique findings deserve MORE attention** - They might be the deepest insights
3. **Consensus ≠ importance** - Obvious issues get caught by all; critical bugs may be subtle
4. **Check what's missing** - The worst bugs are the ones no one found
5. **Compare against PR description** - Do claimed features actually work?
