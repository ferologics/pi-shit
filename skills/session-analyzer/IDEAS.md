# Ideas

## Exact worktree matching

`--pattern <substring>` covers worktrees today, because their session dirs share the repo name: `--pattern orders-app` picks up `orders-app-1`, `orders-app-home-address`, and so on. A substring can also over-match unrelated dirs (`--pattern pi` catches `pi-mono`, `pi-shit`, ...). An `--include-worktrees` flag that reads `git worktree list --porcelain` would match exactly. Worth adding only if over-matching gets in the way.

## Spot repeats of existing rules in `--analyze`

Routing treats a correction that an existing rule already covers as a repeat. Analysis subagents only see transcripts, so they catch this only when a transcript quotes the rule. Passing the target dir's AGENTS.md chain (`~/AGENTS.md` down to the project) to the aggregator would let it check every pattern against existing rules. `/retro` already does this because it runs inside the session.
