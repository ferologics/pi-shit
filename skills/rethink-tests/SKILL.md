---
name: rethink-tests
description: Review an existing test suite from the top down. State what the code promises, map the tests onto those promises, and propose a smaller set of checks (merged, table-driven, property, invariant, model) that proves more. Use when the user wants to find useless tests, simplify or prune a suite, or rethink how an area is tested.
---

# Rethink tests

A suite grows one test at a time. Each test made sense to whoever added it, and nobody steps back to ask what the tests prove together. This skill steps back: start from what the code promises, judge the tests against that, then look for fewer checks that prove more.

## Rules

- Report first. Change tests only when the user asks.
- Back every claim with something you read or ran: `file:line`, a command and its output. Label guesses as guesses.
- Delete a test only after its replacement exists and you have seen the replacement fail on broken code.
- Scope is what the user named. If it's large, start with the biggest pile: rank areas by test count and lines of test code, not by tests per line of production code. Say what you picked and why.

## 1. State the contract

Before reading tests, read the code under test: its public interface, callers, docs, and specs. Write down, one line each:

- **Promises**: what a caller or user can observe. Return values, errors, effects on other systems, state they can read back.
- **Invariants**: what must hold at every step, such as "every request gets exactly one response" or "the published state matches the getter".
- **Seams**: the interfaces where those are observable.

Ask the user only what the code can't answer. This list is the yardstick for everything after it.

## 2. Map the tests

List the tests in scope with the runner (`cargo test -- --list`, `pytest --collect-only`, and so on). Map every test, not a sample. Cluster them mechanically first, by name tokens, shared helpers and fixtures, and setup shape, so every test lands in a cluster with a count. Then tag each cluster with the promise it checks and read the map, not the individual tests:

- **Orphans**: tests that check no promise. They pin internals, restate constants, or test test helpers.
- **Clusters**: many tests on one promise that differ only in input data or setup.
- **Layers**: the same promise checked at several levels (unit, integration, end to end).
- **Wrong seam**: tests that reach past the interface to get at internals.
- **Gaps**: promises nothing checks.

Work the biggest clusters first. A 5-test cluster is not where to start when another has 400.

For each big cluster, find out why it grew. Read the history of its tests (`git log -S`, `git log -L`): which changes added each batch, and in response to what. When tests arrive one per bug report or one per false alarm, the growth is the finding. Whatever keeps producing them is what needs to change.

## 3. Check the signal

Every test claims something in one direction. "Accepts X" guards against a false rejection, "rejects Y" guards against a miss, "returns 15" guards against a wrong value. Put each orphan and each cluster through two edits:

1. **Break the behavior in the direction the test claims**: return a wrong value, skip an effect, do it twice, accept what it should reject. A test that stays green doesn't guard its claim. A break that a whole cluster misses is a blind spot in the cluster, not proof that each test in it is useless; report which direction nothing guards.
2. **Change only the internals**: keep every observable result and restructure the code. A test that goes red is pinned to the implementation.

Run the edits where it's cheap: hand-made breaks aimed at a claim, or a mutation tool (`cargo-mutants`, Stryker, PIT, mutmut) scoped to the code under the cluster. Work in a scratch worktree, never in the user's checkout.

When the code under test is itself a checker, oracle, or validator, its behavior is what it accepts and what it rejects, and both directions need tests. Ask whether it re-implements the code it checks. If it does, it agrees with that code by construction, and every disagreement gets patched with one more special case and one more test.

While reading, look for:

- expected values computed by the code under test
- assertions on data the test built itself
- mocks that implement the behavior the test then asserts

## 4. Find the smaller design

This is the point of the skill. For each cluster, orphan, and gap, ask what single check would prove the promise better than the current tests. Roughly cheapest first:

- **Table**: N copy-pasted tests become one test over a table of cases.
- **Property**: N examples of one rule become one property over generated inputs (proptest, fast-check, Hypothesis). Examples worth keeping become saved seeds.
- **Invariant**: check the rule on every step of a simulator or fuzz run instead of in hand-built scenarios. Saved failing seeds replace hand-written fixtures.
- **Round trip or differential**: encode then decode, old against new, platform against platform, code against a simple reference.
- **Corpus**: many input and output pairs as files, run by one test.
- **Model**: a small TLA+ or state-machine model for ordering and concurrency that tests can't reach.
- **Types**: make the bad state unrepresentable, then delete the tests that guarded it.
- **Delete the code**: when tests are the only callers of a seam, the seam and its tests go together.

Then question the premise:

- Why does the biggest cluster keep growing, and what change would stop it?
- Do tests have to reach past the interface because the module is the wrong shape?
- Does anyone want the behavior a test pins?
- Does a higher layer already cover a whole layer of tests?
- Would a simpler, weaker check that is independent of the code beat a precise one that copies it?

## 5. Report

- **Contract**: promises and invariants, one line each, with gaps marked.
- **Map**: every test in scope by cluster, with counts and the promise each cluster checks, plus the orphans. Mark the clusters you only sampled.
- **Proposals**, biggest win first. For each: what goes, what replaces it, the evidence (mutation results, `file:line`), and what it removes (tests, lines, fixtures, test-only code).
- **Not covered**: what you didn't read or run.

## 6. Apply (only when asked)

For each approved proposal:

1. Write the replacement.
2. Break the code the old tests guarded and confirm the replacement goes red. Restore the code.
3. Delete the old tests along with the fixtures and test-only code they kept alive.
4. Run the affected suites and report the counts before and after.

If the old tests catch a break the replacement misses, keep that case or extend the replacement.
