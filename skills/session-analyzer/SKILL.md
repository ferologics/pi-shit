---
name: session-analyzer
description: Analyze pi session transcripts for repeated instructions and corrections, and route each to the cheapest layer that holds it (repo check, repo skill, AGENTS.md, prompt template, or skill).
---

# Session Analyzer

Extracts and analyzes your pi session transcripts to find recurring patterns that could be automated.

## Usage

```bash
# Extract transcripts for current directory
{baseDir}/analyze.js

# Extract transcripts for specific directory
{baseDir}/analyze.js /path/to/project

# Match multiple dirs by pattern (worktrees, variants, etc.)
{baseDir}/analyze.js --pattern orders-app

# Extract + analyze with subagents
{baseDir}/analyze.js --analyze

# Pattern + analyze (finds all matching session dirs)
{baseDir}/analyze.js --pattern orders-app --analyze

# Custom output directory
{baseDir}/analyze.js --output ./my-analysis --analyze
```

## What It Does

1. **Extract**: Reads all session files for the given working directory from `~/.pi/agent/sessions/`
   - Use `--pattern` to match multiple directories (e.g., worktrees, feature branches)
2. **Split**: Chunks transcripts into ~100k char files (fits in context window)
3. **Analyze** (optional): Spawns pi subagents that find repeated patterns and route each one per [Routing](#routing), then aggregates them into one summary grouped by layer

## Routing

Route each pattern to the first layer that can hold it. Early layers are enforced or load only when needed. Late layers cost context on every turn.

| Layer | TYPE               | Use for                                                                                                                                                           |
| ----- | ------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | `repo-check`       | A mechanical rule (banned API or pattern, file location, format, a command that must run) as a lint rule, hook, CI job, type, or test whose failure names the fix |
| 2     | `repo-skill`       | An occasional multi-step workflow in one repo                                                                                                                     |
| 3     | `repo-agents-md`   | A judgment call needed on most tasks in one repo                                                                                                                  |
| 4     | `prompt-template`  | A request the user types again and again                                                                                                                          |
| 5     | `personal-skill`   | A cross-repo workflow the model should pick up when a task matches (pi-shit)                                                                                      |
| 6     | `global-agents-md` | Taste or a hard rule for every task in every repo (`~/AGENTS.md`)                                                                                                 |

A pattern counts once it has happened twice. A correction that an existing rule already covers is a repeat: route it to a stronger layer than the rule that failed.

For each pattern, state why no earlier layer can hold it.

## Applying findings

Findings are proposals. Apply only the ones the user picks.

- `repo-check`: show the check failing on the past mistake from the evidence before keeping it.
- AGENTS.md layers: read the target file first. Sharpen or remove an existing rule before adding a new one, and keep each rule in one place.

## Output

Without `--analyze`:

```
session-transcripts/
├── session-transcripts-000.txt
├── session-transcripts-001.txt
└── ...
```

With `--analyze`:

```
session-transcripts/
├── session-transcripts-000.txt
├── session-transcripts-000.summary.txt  # Pattern analysis
├── session-transcripts-001.txt
├── session-transcripts-001.summary.txt
└── FINAL-SUMMARY.txt                    # Aggregated findings
```

## Setup

Install dependencies (run once):

```bash
cd {baseDir}
npm install
```

## When to Use

- After working on a project for a while, to discover what rules/skills would help
- Periodically to find new automation opportunities
- When you notice you keep giving similar instructions
- After a rough session, run the `/retro` prompt template to apply the same routing to the current session

---

_Adapted from [badlogic/pi-mono gist](https://gist.github.com/badlogic/55d996b4afc4bd084ce55bb8ddd34594)_
