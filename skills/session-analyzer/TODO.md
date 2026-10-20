# TODO

## Skill bench

Skills we reviewed and parked. Add one only when its trigger shows up in real sessions, for example as a session-analyzer or `/retro` finding. Rewrite it in pi-shit rather than installing the source package.

| Candidate                   | Source                                                                                                                                          | Add it when                                                                                    |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `diagnosing-bugs`           | [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/engineering/diagnosing-bugs) (MIT)                                    | An agent theorizes about a bug before building a repro that fails on it                        |
| `proving-changes`           | [ampcode/official-plugins](https://github.com/ampcode/official-plugins/tree/main/skills/proving-changes) (no license: write our own)            | Agents report "done" without real evidence in a repo that has no verify skill                  |
| `create-verification-skill` | [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack/skills/create-verification-skill) (MIT)                              | A repo needs a scripted way to drive the app, like closeout-copilot's `closeout-local-testing` |
| `benchmark-checklist`       | [cursor/plugins pstack](https://github.com/cursor/plugins/tree/main/pstack/skills/benchmark-checklist) (MIT)                                    | Agents start reporting perf numbers                                                            |
| `grilling`, `handoff`       | [mattpocock/skills](https://github.com/mattpocock/skills/tree/main/skills/productivity) (MIT)                                                   | Plan discussions drag, or work gets handed between sessions                                    |
| Test rule (AGENTS.md line)  | [pstack test-behavior-not-implementation](https://github.com/cursor/plugins/tree/main/pstack/skills/principle-test-behavior-not-implementation) | Agents write tests that would still pass if every imported function returned `undefined`       |
