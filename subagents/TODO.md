# Subagents Exploration

Exploring pi subagents for parallel task delegation.

## References
- Official example: https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent/examples/extensions/subagent
- Async variant: https://github.com/nicobailon/pi-async-subagents

## Setup Status
- [x] Clone pi-async-subagents to `~/.pi/repos/`
- [x] Symlink official subagent to `~/.pi/agent/extensions/`
- [x] Compare official vs async variant
- [x] Create agent definitions in `~/.pi/agent/agents/`
  - researcher.md - web search, docs
  - coder.md - implementation
  - reviewer.md - code review
- [x] Default all agents to `model: claude-4-opus`

## Key Differences: Official vs Async

| Feature | Official | pi-async-subagents |
|---------|----------|-------------------|
| Async (background) mode | ❌ | ✅ |
| Debug artifacts | ❌ | ✅ |
| Output truncation | ❌ | ✅ |
| Session sharing (gist) | ❌ | ✅ |
| Progress widget | ❌ | ✅ |
| Status tool | ❌ | ✅ |
| Code complexity | ~600 lines | ~1700 lines |

## Testing TODO

### Basic Functionality
- [ ] Test single agent delegation
- [ ] Test parallel execution (3 asks → 3 agents simultaneously)
- [ ] Test chain mode with `{previous}` handoffs

### Context & Communication
- [ ] Verify context isolation between agents
- [ ] Test: Can subagents use questionnaire tool to ask user questions?
- [ ] Test: How does main agent receive/interpret subagent output?
- [ ] Test: What happens if subagent context grows too large?

### Steering & Control
- [ ] Can main agent "supervise" and correct subagents mid-task?
- [ ] Design agent prompts that encourage asking vs assuming
- [ ] Test interrupting/aborting a running subagent

## Questions to Answer

1. **Questionnaire from subagents**: Do subagents have access to questionnaire tool? If not, can we add it to their tools list?

2. **Steering mid-task**: Chain mode passes `{previous}` but doesn't allow intervention. Is there a pattern for main agent to review intermediate results and course-correct?

3. **Parallel overhead**: With MAX_CONCURRENCY=4, what's the actual speedup vs sequential? Any token/cost implications?

4. **Error handling**: When a subagent fails, how does main agent know what went wrong? Is the error context sufficient?

5. **Model costs**: With Opus for all agents, what's typical cost for a 3-agent parallel run? Worth having cheaper agents for simple tasks?

## Model Strategy

| Agent | Model | Rationale |
|-------|-------|-----------|
| Default | claude-4-opus | Best reasoning, worth the cost |
| researcher | claude-4-opus | Good judgment on sources |
| coder | claude-4-opus | Complex code needs best model |
| reviewer | claude-4-opus | Nuanced feedback |
| (future) scout | sonnet? | If speed > quality for simple lookups |

## Ideas to Explore

### Supervisor Pattern
Main agent delegates, then reviews subagent output before accepting:
```
1. Main identifies 3 tasks
2. Spawn 3 subagents in parallel
3. Main reviews each result
4. If issues, main can re-delegate or fix directly
```

### Question Escalation
Subagents should escalate questions instead of guessing:
- Add questionnaire to subagent tools
- Prompt subagents to prefer asking over assuming
- Main agent can answer or forward to user

### Structured Output
Have subagents return structured JSON for easier parsing:
- Status: success/partial/failed
- Confidence: high/medium/low
- Questions: [] (things that need clarification)
- Result: actual output

## Decision: Which Extension?

**TBD after testing**

Options:
1. Use official as-is (simpler, maintained)
2. Use pi-async-subagents (more features, community)
3. Fork official and add specific features we need
4. Write our own minimal version

## Next Steps

1. Pick a real task to test with (e.g., "add a feature to pi-extensions")
2. Run single, parallel, and chain modes
3. Document what works and what doesn't
4. Make decision on which extension to use
