# Pro Plan review context

Generated: 2026-03-28T12:26:57Z

## Snapshot

- Repo path: `/Users/zen/dev/pi-shit`
- Base commit snapshot: `d70a55f`

## Purpose

This file is a review handoff for GPT Pro. It bundles:

- the current `pro-plan` extension source code
- the implementation notes and locked V1 decisions so far
- the current limitations and follow-up direction

The source of truth remains the real files under `extensions/pro-plan/`. This document is just a review pack.

## Current intent

`pro-plan` is a Pi extension for human-driven planning that stays inside the current Pi session, optionally calls ChatGPT Pro for planning/finalization passes, stores pass artifacts on disk, and then returns to the original anchor point with a clean implementation handoff.

## Locked V1 decisions

### Session model

- Same Pi session.
- `/pro-plan start` captures an anchor entry in the current session.
- Planning then continues naturally on that branch.
- `/pro-plan apply` navigates back to the anchor and prefills the editor with the finalized plan.
- Raw request/context-pack payloads are **not** injected into the Pi session.

### Pro backend

- V1 uses **Oracle** only as the transport/backend adapter for ChatGPT Pro.
- Pi owns the workflow shape, session behavior, artifacts, and handoff.
- Long term: replace Oracle with a native runner while keeping the same `/pro-plan` UX.

### Why Oracle is used in V1

A direct `openai-codex` OAuth test was already tried against the ChatGPT/Codex backend.

Observed behavior:

- `gpt-5.4` worked
- `gpt-5.4-pro` was rejected by the backend with:
  - `The 'gpt-5.4-pro' model is not supported when using Codex with a ChatGPT account.`

So V1 cannot just expose `gpt-5.4-pro` through Pi's `openai-codex` provider.

### Planning flow

- Planning is human-driven, not wizard-driven.
- The normal Pi agent is used first to iterate on vague or early planning.
- Pro passes happen only when the user decides to run them.
- Multiple back-and-forth passes are expected.

### Code context sourcing

This is intentionally simple in V1.

- A pass can be planning-only (`--no-code`, or no `--path`).
- A code-backed pass uses **explicit path seeds**:
  - files
  - directories
  - globs
- Optional Scribe expansion grows context outward from those seeds.
- No magic natural-language target inference in V1.

### Budgeting

- ChatGPT Pro context window assumption: **400k**.
- Default packed-context budget in V1: **280k**.
- The extension leaves room for:
  - planning transcript
  - pass prompt
  - model response
  - slack / safety margin
- In the current implementation, budget is treated as a **hard admission limit**:
  - request/transcript must fit
  - explicit seeds must fit
  - final rendered pack must fit

### Artifact model

Artifacts live under:

- `~/.pi/agent/pro-plan/`

Per pass, the extension writes timestamped files such as:

- `pass-001-<timestamp>.request.md`
- `pass-001-<timestamp>.pack.md` (optional)
- `pass-001-<timestamp>.response.md`
- `pass-001-<timestamp>.oracle.log`
- `pass-001-<timestamp>.meta.json`

The extension also persists state snapshots via `state.json` in the artifact dir.

## Recent hardening changes after review

The current local implementation already incorporates these review-driven fixes:

- fixed glob-backed `--path` resolution for absolute repo paths
- made budget enforcement hard instead of advisory
- changed explicit `--path` to override inherited defaults
- made unknown flags error instead of silently turning into prompt text
- made artifact filenames unique per attempt to avoid overwriting failed runs
- hardened code fences in context-pack output so embedded triple backticks do not corrupt markdown structure
- improved Oracle abort handling by trying to terminate the full process group and escalating to `SIGKILL`
- reduced text/binary sniffing to only inspect the first 8 KB instead of reading full files for that check
- bare `/pro-plan` now defaults to help when inactive and status when active

## Current command surface

- `/pro-plan start`
- `/pro-plan pass [prompt] [--path <file|dir|glob>] [--budget <tokens>] [--include-dependents] [--include-docs] [--include-tests] [--no-code]`
- `/pro-plan final [same options as pass]`
- `/pro-plan apply`
- `/pro-plan status`
- `/pro-plan stop`

## Current implementation shape

### Main extension behavior

- `index.ts`
  - command registration
  - session state restoration
  - transcript building
  - request markdown building
  - pass execution orchestration
  - apply/status/stop behavior

### Helper modules

- `args.ts`
  - command parsing
  - default budget
  - option handling for pass/final
- `artifacts.ts`
  - artifact dir creation
  - file naming
  - JSON/state writing
- `context-pack.ts`
  - explicit path resolution
  - seed-file loading
  - optional Scribe recall
  - budget fit for related files
  - markdown pack rendering
- `oracle.ts`
  - resolves `oracle` vs `npx @steipete/oracle`
  - runs browser-mode GPT-5.4 Pro pass
  - writes Oracle log and response output
- `types.ts`
  - internal state and result types

### Existing code reused from `deep-review`

`pro-plan` currently reuses some deterministic context-pack pieces from:

- `extensions/deep-review/context-pack/budget.ts`
- `extensions/deep-review/context-pack/filters.ts`
- `extensions/deep-review/context-pack/rank.ts`
- `extensions/deep-review/context-pack/scribe.ts`
- `extensions/deep-review/context-pack/types.ts`

This reuse is intentionally narrow. V1 does **not** try to turn deep-review's diff-seeded packer into the core pro-plan model.

## Current known limitations and rough edges

- Status UX is still basic.
- No custom markdown renderers yet for pro-plan messages.
- No richer resume/replay UI yet.
- Code-context defaults are still primitive.
- The context packer is explicit-seed-based only.
- Directory seeds can still get expensive on very large trees.
- Oracle remains an external dependency in V1.
- `/pro-plan end` is not currently aliased to anything; the surface is still strict.

## Current V2 direction

- Replace Oracle with a native Pro transport.
- Improve code-context sourcing beyond explicit path specs.
- Improve replay, resume, and pass management.
- Keep the same overall `/pro-plan` workflow shape while swapping the backend.

## File map

- `extensions/pro-plan/index.ts`
- `extensions/pro-plan/args.ts`
- `extensions/pro-plan/artifacts.ts`
- `extensions/pro-plan/context-pack.ts`
- `extensions/pro-plan/oracle.ts`
- `extensions/pro-plan/types.ts`
- `extensions/pro-plan/args.test.ts`
- `extensions/pro-plan/README.md`
- `extensions/pro-plan/VISION.md`
- `extensions/pro-plan/TODO.md`

## Source code

## `extensions/pro-plan/index.ts`

```ts
import { access, readFile, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { parseCommand, getDefaultBudget } from "./args.js";
import { createArtifactDir, artifactPaths, writeJson, writeStateFile } from "./artifacts.js";
import { buildPlanningContextPack, countMarkdownTokens } from "./context-pack.js";
import { readOracleResponse, runOracleBrowser } from "./oracle.js";
import type { ProPlanMode, ProPlanPassOptions, ProPlanState } from "./types.js";

const HELP_TEXT = `# /pro-plan

Commands:
- /pro-plan start
- /pro-plan pass [prompt] [--path <file|dir|glob>] [--budget <tokens>] [--include-dependents] [--include-docs] [--include-tests] [--no-code]
- /pro-plan final [prompt] [same options as pass]
- /pro-plan apply
- /pro-plan status
- /pro-plan stop

Notes:
- Planning stays in the current session on its own branch.
- /pro-plan start creates a non-context anchor entry and artifact directory.
- pass/final store request, optional context pack, response, Oracle log, and metadata on disk.
- Code context is explicit in V1: provide --path specs when you want code packed for Pro.
- If you omit --path, the pass is planning-only unless previous code defaults exist.
- /pro-plan apply returns to the origin anchor and prefills the editor with the finalized plan.`;

type SessionMessageEntry = {
    type: string;
    id?: string;
    customType?: string;
    content?: unknown;
    summary?: string;
    data?: unknown;
    message?: {
        role?: string;
        content?: unknown;
    };
};

type RunState = {
    controller: AbortController;
    startedAt: number;
    phase: string;
    interval: ReturnType<typeof setInterval> | null;
};

function defaultState(): ProPlanState {
    return {
        active: false,
        passCount: 0,
        defaults: {
            projectDir: process.cwd(),
            pathSpecs: [],
            budget: getDefaultBudget(),
            includeDependents: true,
            includeDocs: false,
            includeTests: false,
        },
    };
}

function extractText(value: unknown): string {
    if (typeof value === "string") {
        return value;
    }

    if (!Array.isArray(value)) {
        return "";
    }

    return value
        .flatMap((part) => {
            if (!part || typeof part !== "object") {
                return [];
            }

            const typed = part as { type?: string; text?: string; name?: string; arguments?: unknown };
            if (typed.type === "text" && typeof typed.text === "string") {
                return [typed.text];
            }

            if (typed.type === "toolCall" && typeof typed.name === "string") {
                return [`[tool ${typed.name}] ${JSON.stringify(typed.arguments ?? {})}`];
            }

            return [];
        })
        .join("\n")
        .trim();
}

function buildPlanningTranscript(entries: SessionMessageEntry[], anchorEntryId?: string): string {
    const anchorIndex = anchorEntryId ? entries.findIndex((entry) => entry.id === anchorEntryId) : -1;
    const relevantEntries = anchorIndex >= 0 ? entries.slice(anchorIndex + 1) : entries;
    const lines: string[] = [];

    for (const entry of relevantEntries) {
        if (entry.type === "message") {
            const role = entry.message?.role;
            const text = extractText(entry.message?.content);
            if (!text) {
                continue;
            }

            if (role === "user") {
                lines.push(`## User\n${text}`);
                continue;
            }

            if (role === "assistant") {
                lines.push(`## Pi planning assistant\n${text}`);
                continue;
            }
        }

        if (entry.type === "branch_summary" && typeof entry.summary === "string") {
            lines.push(`## Branch summary\n${entry.summary}`);
            continue;
        }

        if (entry.type === "compaction" && typeof entry.summary === "string") {
            lines.push(`## Compaction summary\n${entry.summary}`);
            continue;
        }

        if (entry.type === "custom_message" && typeof entry.customType === "string") {
            if (!["pro-plan-result", "pro-plan-final"].includes(entry.customType)) {
                continue;
            }

            const text = extractText(entry.content);
            if (!text) {
                continue;
            }

            const heading = entry.customType === "pro-plan-final" ? "## Pro final pass" : "## Pro pass";
            lines.push(`${heading}\n${text}`);
        }
    }

    return lines.join("\n\n").trim();
}

function buildRequestMarkdown(mode: ProPlanMode, prompt: string, transcript: string): string {
    const passSpecificInstruction =
        mode === "final"
            ? [
                  "Produce an execution-grade final plan.",
                  "Make the plan decisive, concrete, and implementation-ready.",
                  "Call out phases, file/module touch points when justified, risks, validation, and open questions.",
              ].join("\n")
            : [
                  "Refine the current planning work.",
                  "Challenge weak assumptions, improve structure, and sharpen the implementation direction.",
                  "Prefer a crisp, actionable plan over vague brainstorming.",
              ].join("\n");

    const extraPrompt = prompt.trim().length > 0 ? prompt.trim() : "No extra user prompt for this pass.";

    return [
        "# Pro Plan Request",
        "",
        `- Generated: ${new Date().toISOString()}`,
        `- Mode: ${mode}`,
        "",
        "## Instructions",
        "",
        "You are helping finalize or refine a software implementation plan.",
        passSpecificInstruction,
        "Use the attached context pack if one is present.",
        "Do not assume code outside the provided planning transcript and attachments.",
        "",
        "## Extra prompt for this pass",
        "",
        extraPrompt,
        "",
        "## Planning branch transcript",
        "",
        transcript.length > 0 ? transcript : "No planning transcript was captured yet.",
        "",
    ].join("\n");
}

function buildApplyEditorText(response: string): string {
    return [
        "Use this finalized implementation plan as the execution brief.",
        "Inspect the repo as needed, then implement it decisively.",
        "",
        "<final-plan>",
        response.trim(),
        "</final-plan>",
    ].join("\n");
}

async function fileExists(targetPath: string | undefined): Promise<boolean> {
    if (!targetPath) {
        return false;
    }

    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function persistState(pi: ExtensionAPI, state: ProPlanState): Promise<void> {
    state.updatedAt = Date.now();
    pi.appendEntry("pro-plan-state", state);
    if (state.artifactDir) {
        await writeStateFile(state.artifactDir, state);
    }
}

function setIdleStatus(ctx: ExtensionContext, state: ProPlanState): void {
    if (!state.active) {
        ctx.ui.setStatus("pro-plan", undefined);
        return;
    }

    const label =
        state.passCount > 0
            ? `pro-plan · ${state.passCount} pass${state.passCount === 1 ? "" : "es"}`
            : "pro-plan · active";
    ctx.ui.setStatus("pro-plan", ctx.ui.theme.fg("accent", label));
}

function startRunWidget(ctx: ExtensionContext, run: RunState): void {
    const spinnerFrames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

    const render = () => {
        const now = Date.now();
        const spinner = spinnerFrames[Math.floor(now / 80) % spinnerFrames.length] ?? spinnerFrames[0];
        const elapsedSeconds = Math.max(0, Math.floor((now - run.startedAt) / 1000));
        ctx.ui.setStatus("pro-plan", ctx.ui.theme.fg("accent", `${spinner} pro-plan · ${run.phase}`));
        ctx.ui.setWidget("pro-plan-live", [
            ctx.ui.theme.fg("accent", `${spinner} pro-plan · ${run.phase}`),
            ctx.ui.theme.fg("dim", `elapsed ${elapsedSeconds}s · /pro-plan stop to abort`),
        ]);
        ctx.ui.setWorkingMessage("pro-plan running...");
    };

    render();
    run.interval = setInterval(render, 120);
}

function stopRunWidget(ctx: ExtensionContext, run: RunState | null, state: ProPlanState): void {
    if (run?.interval) {
        clearInterval(run.interval);
        run.interval = null;
    }
    ctx.ui.setWidget("pro-plan-live", undefined);
    ctx.ui.setWorkingMessage();
    setIdleStatus(ctx, state);
}

function restoreStateFromEntries(entries: SessionMessageEntry[]): ProPlanState {
    const restored = defaultState();

    for (const entry of entries) {
        if (
            entry.type !== "custom" ||
            entry.customType !== "pro-plan-state" ||
            !entry.data ||
            typeof entry.data !== "object"
        ) {
            continue;
        }

        Object.assign(restored, entry.data);
    }

    if (!restored.defaults) {
        restored.defaults = defaultState().defaults;
    }

    return restored;
}

async function handleStart(pi: ExtensionAPI, state: ProPlanState, ctx: ExtensionCommandContext): Promise<void> {
    if (state.active) {
        ctx.ui.notify(`pro-plan is already active${state.artifactDir ? ` · ${state.artifactDir}` : ""}`, "warning");
        return;
    }

    pi.appendEntry("pro-plan-anchor", {
        cwd: process.cwd(),
        startedAt: Date.now(),
    });

    const anchorEntryId = ctx.sessionManager.getLeafId();
    if (!anchorEntryId) {
        throw new Error("Failed to capture pro-plan anchor entry id.");
    }

    pi.setLabel(anchorEntryId, "pro-plan-origin");
    const artifactDir = await createArtifactDir(anchorEntryId);

    state.active = true;
    state.anchorEntryId = anchorEntryId;
    state.artifactDir = artifactDir;
    state.startedAt = Date.now();
    state.passCount = 0;
    state.latestMode = undefined;
    state.latestRequestPath = undefined;
    state.latestPackPath = undefined;
    state.latestResponsePath = undefined;
    state.latestLogPath = undefined;
    state.finalResponsePath = undefined;
    state.defaults = {
        projectDir: process.cwd(),
        pathSpecs: [],
        budget: getDefaultBudget(),
        includeDependents: true,
        includeDocs: false,
        includeTests: false,
    };

    await persistState(pi, state);
    setIdleStatus(ctx, state);

    pi.sendMessage({
        customType: "pro-plan-status",
        content: `Started pro-plan.\n\nArtifacts: \`${artifactDir}\``,
        display: true,
    });
    ctx.ui.notify("pro-plan started", "info");
}

async function handlePass(
    pi: ExtensionAPI,
    state: ProPlanState,
    ctx: ExtensionCommandContext,
    options: ProPlanPassOptions,
    runRef: { current: RunState | null },
): Promise<void> {
    if (!state.active || !state.anchorEntryId || !state.artifactDir) {
        ctx.ui.notify("No active pro-plan. Start one with /pro-plan start", "warning");
        return;
    }

    if (runRef.current) {
        ctx.ui.notify("A pro-plan run is already in progress", "warning");
        return;
    }

    const entries = ctx.sessionManager.getBranch() as SessionMessageEntry[];
    const transcript = buildPlanningTranscript(entries, state.anchorEntryId);
    const requestMarkdown = buildRequestMarkdown(options.mode, options.prompt, transcript);
    const requestTokens = await countMarkdownTokens(requestMarkdown);
    if (requestTokens.tokens >= options.budget) {
        throw new Error(
            `Planning transcript and pass prompt already consume ${requestTokens.tokens.toLocaleString()} tokens, leaving no room inside the configured budget of ${options.budget.toLocaleString()} tokens. Compact the branch, narrow the planning transcript, or raise the budget.`,
        );
    }

    const passNumber = state.passCount + 1;
    const shouldUseCode = !options.noCode && options.pathSpecs.length > 0;
    const paths = artifactPaths(state.artifactDir, passNumber, options.mode, shouldUseCode);
    await writeFile(paths.requestPath, requestMarkdown, "utf8");

    let packResult: Awaited<ReturnType<typeof buildPlanningContextPack>> | undefined;
    let packWarnings: string[] = [];

    if (shouldUseCode && paths.packPath) {
        const packBudget = options.budget - requestTokens.tokens;
        packResult = await buildPlanningContextPack(
            {
                ...options,
                budget: packBudget,
            },
            paths.packPath,
        );
        packWarnings = packResult.warnings;
    }

    const run: RunState = {
        controller: new AbortController(),
        startedAt: Date.now(),
        phase: options.mode === "final" ? "final pass" : "pro pass",
        interval: null,
    };
    runRef.current = run;
    startRunWidget(ctx, run);

    try {
        const oracleResult = await runOracleBrowser({
            requestPath: paths.requestPath,
            responsePath: paths.responsePath,
            logPath: paths.logPath,
            packPath: paths.packPath,
            signal: run.controller.signal,
        });

        const responseExists = await fileExists(paths.responsePath);
        if (!responseExists) {
            throw new Error(`Oracle did not produce a response file. See log: ${paths.logPath}`);
        }

        const responseText = await readOracleResponse(paths.responsePath);
        if (!responseText) {
            throw new Error(`Oracle response was empty. See log: ${paths.logPath}`);
        }

        state.passCount = passNumber;
        state.latestMode = options.mode;
        state.latestRequestPath = paths.requestPath;
        state.latestPackPath = paths.packPath;
        state.latestResponsePath = paths.responsePath;
        state.latestLogPath = paths.logPath;
        if (options.mode === "final") {
            state.finalResponsePath = paths.responsePath;
        }
        if (!options.noCode && options.pathSpecs.length > 0) {
            state.defaults = {
                projectDir: options.projectDir,
                pathSpecs: options.pathSpecs,
                budget: options.budget,
                includeDependents: options.includeDependents,
                includeDocs: options.includeDocs,
                includeTests: options.includeTests,
            };
        }

        await writeJson(paths.metaPath, {
            mode: options.mode,
            generatedAt: new Date().toISOString(),
            prompt: options.prompt,
            requestTokens,
            packTokens: packResult?.tokenCount,
            packWarnings,
            oracle: {
                exitCode: oracleResult.exitCode,
                stdoutBytes: oracleResult.stdout.length,
                stderrBytes: oracleResult.stderr.length,
            },
            paths,
        });

        await persistState(pi, state);
        stopRunWidget(ctx, runRef.current, state);
        runRef.current = null;

        pi.sendMessage({
            customType: options.mode === "final" ? "pro-plan-final" : "pro-plan-result",
            content: responseText,
            display: true,
        });

        const warningSuffix = packWarnings.length > 0 ? ` · ${packWarnings.length} pack warning(s)` : "";
        ctx.ui.notify(`pro-plan ${options.mode} complete${warningSuffix}`, "info");
    } catch (error) {
        stopRunWidget(ctx, runRef.current, state);
        runRef.current = null;

        const message = error instanceof Error ? error.message : String(error);
        pi.sendMessage({
            customType: "pro-plan-error",
            content: `pro-plan ${options.mode} failed: ${message}`,
            display: true,
        });
        ctx.ui.notify(`pro-plan ${options.mode} failed`, "error");
    }
}

async function handleApply(pi: ExtensionAPI, state: ProPlanState, ctx: ExtensionCommandContext): Promise<void> {
    if (!state.active || !state.anchorEntryId) {
        ctx.ui.notify("No active pro-plan to apply", "warning");
        return;
    }

    const sourcePath = state.finalResponsePath ?? state.latestResponsePath;
    if (!(await fileExists(sourcePath))) {
        ctx.ui.notify("No finalized pro-plan response found yet", "warning");
        return;
    }

    const response = await readFile(sourcePath!, "utf8");
    await ctx.navigateTree(state.anchorEntryId, {
        summarize: false,
        label: "pro-plan-origin",
    });

    ctx.ui.setEditorText(buildApplyEditorText(response));
    state.active = false;
    await persistState(pi, state);
    setIdleStatus(ctx, state);
    ctx.ui.notify("Returned to pro-plan origin and filled the editor with the final handoff", "info");
}

async function handleStatus(state: ProPlanState, ctx: ExtensionCommandContext): Promise<void> {
    if (!state.active) {
        ctx.ui.notify("No active pro-plan", "info");
        return;
    }

    const lines = [
        `pro-plan active`,
        state.artifactDir ? `artifacts: ${state.artifactDir}` : undefined,
        state.anchorEntryId ? `anchor: ${state.anchorEntryId}` : undefined,
        `passes: ${state.passCount}`,
        state.latestResponsePath ? `latest response: ${state.latestResponsePath}` : undefined,
        state.finalResponsePath ? `final response: ${state.finalResponsePath}` : undefined,
    ].filter((line): line is string => Boolean(line));

    ctx.ui.notify(lines.join("\n"), "info");
}

async function handleStop(
    pi: ExtensionAPI,
    state: ProPlanState,
    ctx: ExtensionCommandContext,
    runRef: { current: RunState | null },
): Promise<void> {
    if (runRef.current) {
        runRef.current.controller.abort();
        ctx.ui.notify("Stopping pro-plan run...", "warning");
        return;
    }

    if (!state.active) {
        ctx.ui.notify("No active pro-plan", "info");
        return;
    }

    state.active = false;
    await persistState(pi, state);
    setIdleStatus(ctx, state);
    ctx.ui.notify("pro-plan stopped", "info");
}

export default function proPlanExtension(pi: ExtensionAPI): void {
    let state = defaultState();
    const runRef: { current: RunState | null } = { current: null };

    pi.on("session_start", async (_event, ctx) => {
        const entries = ctx.sessionManager.getEntries() as SessionMessageEntry[];
        state = restoreStateFromEntries(entries);
        runRef.current = null;
        setIdleStatus(ctx, state);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        stopRunWidget(ctx, runRef.current, state);
        runRef.current = null;
    });

    pi.registerCommand("pro-plan", {
        description: "Planning branch workflow with optional Pro passes via Oracle",
        handler: async (rawArgs, ctx) => {
            try {
                const parsed = parseCommand(rawArgs, process.cwd(), state);
                if ("error" in parsed) {
                    pi.sendMessage({
                        customType: "pro-plan-error",
                        content: `${parsed.error}\n\nUse /pro-plan help for usage.`,
                        display: true,
                    });
                    return;
                }

                if (parsed.subcommand === "help") {
                    pi.sendMessage({
                        customType: "pro-plan-help",
                        content: HELP_TEXT,
                        display: true,
                    });
                    return;
                }

                if (parsed.subcommand === "start") {
                    await handleStart(pi, state, ctx);
                    return;
                }

                if (parsed.subcommand === "status") {
                    await handleStatus(state, ctx);
                    return;
                }

                if (parsed.subcommand === "stop") {
                    await handleStop(pi, state, ctx, runRef);
                    return;
                }

                if (parsed.subcommand === "apply") {
                    await handleApply(pi, state, ctx);
                    return;
                }

                await handlePass(pi, state, ctx, parsed.options!, runRef);
            } catch (error) {
                const message = error instanceof Error ? error.message : String(error);
                pi.sendMessage({
                    customType: "pro-plan-error",
                    content: `pro-plan failed: ${message}`,
                    display: true,
                });
                ctx.ui.notify("pro-plan failed", "error");
            }
        },
    });
}
```

## `extensions/pro-plan/args.ts`

```ts
import path from "node:path";
import type { ParsedCommand, ProPlanPassOptions, ProPlanState } from "./types.js";

const DEFAULT_BUDGET = 280000;

function splitArgs(input: string, platform = process.platform): string[] {
    const tokens: string[] = [];
    let current = "";
    let quote: '"' | "'" | null = null;
    let escaping = false;

    for (const char of input) {
        if (escaping) {
            current += char;
            escaping = false;
            continue;
        }

        if (char === "\\") {
            const shouldEscape = platform !== "win32" || quote !== null;
            if (shouldEscape) {
                escaping = true;
                continue;
            }

            current += char;
            continue;
        }

        if (quote) {
            if (char === quote) {
                quote = null;
            } else {
                current += char;
            }
            continue;
        }

        if (char === '"' || char === "'") {
            quote = char;
            continue;
        }

        if (/\s/.test(char)) {
            if (current.length > 0) {
                tokens.push(current);
                current = "";
            }
            continue;
        }

        current += char;
    }

    if (escaping) {
        current += "\\";
    }

    if (current.length > 0) {
        tokens.push(current);
    }

    return tokens;
}

function parseBudget(value: string): number | undefined {
    const normalized = value.replace(/[,_]/g, "");
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
        return undefined;
    }
    return parsed;
}

function buildDefaults(cwd: string, state: ProPlanState | undefined): ProPlanPassOptions {
    return {
        mode: "pass",
        prompt: "",
        projectDir: state?.defaults?.projectDir ?? cwd,
        pathSpecs: state?.defaults?.pathSpecs ?? [],
        budget: state?.defaults?.budget ?? DEFAULT_BUDGET,
        includeDependents: state?.defaults?.includeDependents ?? true,
        includeDocs: state?.defaults?.includeDocs ?? false,
        includeTests: state?.defaults?.includeTests ?? false,
        noCode: false,
    };
}

export function getDefaultBudget(): number {
    return DEFAULT_BUDGET;
}

export function parseCommand(rawArgs: string, cwd: string, state?: ProPlanState): ParsedCommand | { error: string } {
    const tokens = splitArgs(rawArgs);
    const [subcommandRaw, ...rest] = tokens;
    const defaultSubcommand = state?.active ? "status" : "help";
    const subcommand = (subcommandRaw ?? defaultSubcommand).toLowerCase();

    if (["help", "--help", "-h"].includes(subcommand)) {
        return { subcommand: "help" };
    }

    if (["start", "apply", "status", "stop"].includes(subcommand)) {
        return { subcommand: subcommand as ParsedCommand["subcommand"] };
    }

    if (!["pass", "final"].includes(subcommand)) {
        return { error: `Unknown subcommand: ${subcommandRaw ?? ""}`.trim() };
    }

    const options = buildDefaults(cwd, state);
    options.mode = subcommand as "pass" | "final";

    const positional: string[] = [];
    let sawExplicitPath = false;

    for (let index = 0; index < rest.length; index += 1) {
        const token = rest[index] ?? "";
        const next = rest[index + 1];

        switch (token) {
            case "--path": {
                if (!next) {
                    return { error: `${token} requires a value` };
                }
                if (!sawExplicitPath) {
                    options.pathSpecs = [];
                    sawExplicitPath = true;
                }
                options.pathSpecs.push(next);
                index += 1;
                break;
            }
            case "--project": {
                if (!next) {
                    return { error: `${token} requires a value` };
                }
                options.projectDir = path.resolve(cwd, next);
                index += 1;
                break;
            }
            case "--budget": {
                if (!next) {
                    return { error: `${token} requires a value` };
                }
                const parsed = parseBudget(next);
                if (!parsed) {
                    return { error: `Invalid budget: ${next}` };
                }
                options.budget = parsed;
                index += 1;
                break;
            }
            case "--no-code": {
                options.noCode = true;
                break;
            }
            case "--include-dependents": {
                options.includeDependents = true;
                break;
            }
            case "--no-dependents": {
                options.includeDependents = false;
                break;
            }
            case "--include-docs": {
                options.includeDocs = true;
                break;
            }
            case "--include-tests": {
                options.includeTests = true;
                break;
            }
            case "--help":
            case "-h": {
                return { subcommand: "help" };
            }
            default: {
                if (token.startsWith("-")) {
                    return { error: `Unknown option: ${token}` };
                }
                positional.push(token);
                break;
            }
        }
    }

    options.prompt = positional.join(" ").trim();

    if (options.noCode) {
        options.pathSpecs = [];
    }

    options.pathSpecs = [
        ...new Set(options.pathSpecs.map((value) => value.trim()).filter((value) => value.length > 0)),
    ];

    return {
        subcommand: subcommand as "pass" | "final",
        options,
    };
}
```

## `extensions/pro-plan/artifacts.ts`

```ts
import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactPaths, ProPlanMode, ProPlanState } from "./types.js";

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function pad3(value: number): string {
    return String(value).padStart(3, "0");
}

function timestampForPath(date = new Date()): string {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        "-",
        pad2(date.getHours()),
        pad2(date.getMinutes()),
        pad2(date.getSeconds()),
        "-",
        pad3(date.getMilliseconds()),
    ].join("");
}

function sanitizeSegment(value: string): string {
    const normalized = value.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
    return normalized.length > 0 ? normalized : "session";
}

export async function createArtifactDir(anchorEntryId: string): Promise<string> {
    const root = path.join(os.homedir(), ".pi", "agent", "pro-plan");
    const cwdName = sanitizeSegment(path.basename(process.cwd()));
    const dir = path.join(root, `${timestampForPath()}-${cwdName}-${anchorEntryId.slice(0, 8)}`);
    await mkdir(dir, { recursive: true });
    return dir;
}

export function artifactPaths(
    artifactDir: string,
    passNumber: number,
    mode: ProPlanMode,
    hasPack: boolean,
): ArtifactPaths {
    const base = `${mode}-${String(passNumber).padStart(3, "0")}-${timestampForPath()}`;

    return {
        requestPath: path.join(artifactDir, `${base}.request.md`),
        responsePath: path.join(artifactDir, `${base}.response.md`),
        logPath: path.join(artifactDir, `${base}.oracle.log`),
        metaPath: path.join(artifactDir, `${base}.meta.json`),
        packPath: hasPack ? path.join(artifactDir, `${base}.pack.md`) : undefined,
    };
}

export async function writeJson(targetPath: string, value: unknown): Promise<void> {
    await writeFile(targetPath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

export async function writeStateFile(artifactDir: string, state: ProPlanState): Promise<void> {
    await writeJson(path.join(artifactDir, "state.json"), state);
}
```

## `extensions/pro-plan/context-pack.ts`

```ts
import { execFile } from "node:child_process";
import { access, mkdtemp, open, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fitRelatedCandidatesToBudget } from "../deep-review/context-pack/budget.js";
import { evaluateChangedFile, evaluateRelatedFile } from "../deep-review/context-pack/filters.js";
import { rankRelatedCandidates } from "../deep-review/context-pack/rank.js";
import { runScribeRecall } from "../deep-review/context-pack/scribe.js";
import type {
    ContextPackOptions,
    ContextPackRepoContext,
    RankedRelatedCandidate,
    RelatedCandidate,
    ScribeTargetRequest,
} from "../deep-review/context-pack/types.js";
import type { ContextPackResult, CountTokensResult, OmittedFile, PackedFile, ProPlanPassOptions } from "./types.js";

const execFileAsync = promisify(execFile);
const EXEC_MAX_BUFFER = 128 * 1024 * 1024;
const TOKEN_ENCODING = "o200k-base" as const;
const SCRIBE_TARGET_EXTENSIONS = new Set([".rs", ".py", ".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".go"]);

function normalizePath(value: string): string {
    return value.replace(/\\/g, "/").replace(/^\.\//, "").trim();
}

function hasGlob(value: string): boolean {
    return /[*?[\]{}]/.test(value);
}

function fileExtension(value: string): string {
    return path.extname(normalizePath(value)).toLowerCase();
}

function isScribeTarget(value: string): boolean {
    return SCRIBE_TARGET_EXTENSIONS.has(fileExtension(value));
}

function createFilterOptions(projectDir: string, input: ProPlanPassOptions, related: boolean): ContextPackOptions {
    return {
        projectDir,
        baseRef: "HEAD",
        budget: input.budget,
        outputName: "pro-plan-pack",
        tmpOutput: true,
        includeDependents: input.includeDependents,
        includeDocs: related ? input.includeDocs : true,
        includeTests: related ? input.includeTests : true,
        includeLockfiles: true,
        includeEnv: false,
        includeSecrets: false,
        diffContext: 3,
        includePrDescription: false,
        noClipboard: true,
        failOverBudget: false,
        debug: false,
    };
}

async function pathExists(targetPath: string): Promise<boolean> {
    try {
        await access(targetPath);
        return true;
    } catch {
        return false;
    }
}

async function fileIsLikelyText(filePath: string): Promise<boolean> {
    try {
        const handle = await open(filePath, "r");
        try {
            const buffer = Buffer.alloc(8192);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            for (let index = 0; index < bytesRead; index += 1) {
                if (buffer[index] === 0) {
                    return false;
                }
            }
            return true;
        } finally {
            await handle.close();
        }
    } catch {
        return false;
    }
}

async function resolveRepoRoot(projectDir: string): Promise<string> {
    try {
        const result = await execFileAsync("git", ["-C", projectDir, "rev-parse", "--show-toplevel"], {
            maxBuffer: 1024 * 1024,
        });
        const value = result.stdout.trim();
        return value.length > 0 ? value : projectDir;
    } catch {
        return projectDir;
    }
}

async function walkFiles(rootDir: string): Promise<string[]> {
    const resolved: string[] = [];
    const entries = await readdir(rootDir, { withFileTypes: true });

    for (const entry of entries) {
        const absolutePath = path.join(rootDir, entry.name);
        if (entry.isDirectory()) {
            resolved.push(...(await walkFiles(absolutePath)));
            continue;
        }

        if (entry.isFile()) {
            resolved.push(absolutePath);
        }
    }

    return resolved;
}

async function resolveGlob(projectDir: string, spec: string): Promise<string[]> {
    try {
        const result = await execFileAsync("rg", ["--files", "-g", spec], {
            cwd: projectDir,
            maxBuffer: EXEC_MAX_BUFFER,
        });
        return result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => path.resolve(projectDir, line));
    } catch {
        return [];
    }
}

async function resolvePathSpecs(projectDir: string, specs: string[]): Promise<{ files: string[]; warnings: string[] }> {
    const files = new Set<string>();
    const warnings: string[] = [];

    for (const spec of specs) {
        if (hasGlob(spec)) {
            const matches = await resolveGlob(projectDir, spec);
            if (matches.length === 0) {
                warnings.push(`Path spec matched nothing: ${spec}`);
                continue;
            }
            for (const match of matches) {
                files.add(path.resolve(match));
            }
            continue;
        }

        const resolvedPath = path.resolve(projectDir, spec);
        if (!(await pathExists(resolvedPath))) {
            warnings.push(`Path spec not found: ${spec}`);
            continue;
        }

        const fileStat = await stat(resolvedPath);
        if (fileStat.isDirectory()) {
            const nestedFiles = await walkFiles(resolvedPath);
            for (const nestedFile of nestedFiles) {
                files.add(path.resolve(nestedFile));
            }
            continue;
        }

        if (fileStat.isFile()) {
            files.add(path.resolve(resolvedPath));
        }
    }

    return {
        files: [...files].sort(),
        warnings,
    };
}

async function countTokensForFile(filePath: string): Promise<CountTokensResult> {
    try {
        const result = await execFileAsync("tokencount", ["--encoding", TOKEN_ENCODING, filePath], {
            maxBuffer: EXEC_MAX_BUFFER,
        });
        const firstLine = result.stdout.split(/\r?\n/).find((line) => line.trim().length > 0) ?? "";
        const tokenText = firstLine.trim().split(/\s+/)[0] ?? "";
        const parsed = Number(tokenText);
        if (Number.isFinite(parsed) && parsed >= 0) {
            return { tokens: parsed, method: "tokencount" };
        }
    } catch {
        // fall through
    }

    const text = await readFile(filePath, "utf8");
    return {
        tokens: Math.max(1, Math.ceil(text.length / 4)),
        method: "estimate",
    };
}

async function countTokensForText(text: string): Promise<CountTokensResult> {
    const scratchDir = await mkdtemp(path.join(os.tmpdir(), "pro-plan-token-"));
    const scratchPath = path.join(scratchDir, "count.txt");

    try {
        await writeFile(scratchPath, text, "utf8");
        return await countTokensForFile(scratchPath);
    } finally {
        await rm(scratchDir, { recursive: true, force: true });
    }
}

async function loadPackedFile(repoRoot: string, absolutePath: string): Promise<PackedFile> {
    const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
    const content = await readFile(absolutePath, "utf8");
    const counted = await countTokensForFile(absolutePath);
    return {
        path: relativePath,
        content,
        tokens: counted.tokens,
    };
}

function mergeCandidate(
    existing: RankedRelatedCandidate | undefined,
    candidate: RelatedCandidate,
): RankedRelatedCandidate {
    if (!existing) {
        return {
            ...candidate,
            rank: 0,
        };
    }

    return {
        ...existing,
        frequency: existing.frequency + 1,
        distance: Math.min(existing.distance, candidate.distance),
        relationWeight: Math.max(existing.relationWeight, candidate.relationWeight),
    };
}

function codeFenceFor(content: string): string {
    const runs = content.match(/`+/g) ?? [];
    const longestRun = runs.reduce((max, run) => Math.max(max, run.length), 0);
    return "`".repeat(Math.max(3, longestRun + 1));
}

function appendPackedFiles(lines: string[], title: string, files: PackedFile[]): void {
    lines.push(title);
    lines.push("");

    if (files.length === 0) {
        lines.push("None");
        lines.push("");
        return;
    }

    for (const file of files) {
        const fence = codeFenceFor(file.content);
        lines.push(`### ${file.path}`);
        lines.push("");
        lines.push(fence);
        lines.push(file.content);
        if (!file.content.endsWith("\n")) {
            lines.push("");
        }
        lines.push(fence);
        lines.push("");
    }
}

function renderPackMarkdown(seedFiles: PackedFile[], relatedFiles: PackedFile[], omittedFiles: OmittedFile[]): string {
    const lines: string[] = [];

    lines.push("# Pro Plan Context Pack");
    lines.push("");
    lines.push(`- Generated: ${new Date().toISOString()}`);
    lines.push(`- Seed files: ${seedFiles.length}`);
    lines.push(`- Related files: ${relatedFiles.length}`);
    lines.push(`- Omitted files: ${omittedFiles.length}`);
    lines.push("");

    appendPackedFiles(lines, `## Seed files (${seedFiles.length})`, seedFiles);
    appendPackedFiles(lines, `## Related files (${relatedFiles.length})`, relatedFiles);

    lines.push(`## Omitted files (${omittedFiles.length})`);
    lines.push("");
    if (omittedFiles.length === 0) {
        lines.push("None");
    } else {
        for (const omitted of omittedFiles) {
            lines.push(`- ${omitted.path} — ${omitted.reason}`);
        }
    }
    lines.push("");

    return lines.join("\n");
}

export async function buildPlanningContextPack(
    options: ProPlanPassOptions,
    outputPath: string,
): Promise<ContextPackResult> {
    if (options.pathSpecs.length === 0) {
        throw new Error("No path specs were provided for this code-backed pass.");
    }

    const projectDir = path.resolve(options.projectDir);
    const repoRoot = await resolveRepoRoot(projectDir);
    const resolved = await resolvePathSpecs(projectDir, options.pathSpecs);
    const seedFilterOptions = createFilterOptions(projectDir, options, false);
    const relatedFilterOptions = createFilterOptions(projectDir, options, true);
    const omittedFiles: OmittedFile[] = [];

    const seedFiles: PackedFile[] = [];
    for (const absolutePath of resolved.files) {
        const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
        const decision = evaluateChangedFile(relativePath, seedFilterOptions);
        if (!decision.include) {
            omittedFiles.push({ path: relativePath, reason: decision.reason ?? "filtered:unknown" });
            continue;
        }

        if (!(await fileIsLikelyText(absolutePath))) {
            omittedFiles.push({ path: relativePath, reason: "filtered:binary" });
            continue;
        }

        seedFiles.push(await loadPackedFile(repoRoot, absolutePath));
    }

    if (seedFiles.length === 0) {
        throw new Error("No seed files were eligible after filtering. Adjust --path inputs or disable code packing.");
    }

    const seedBudget = seedFiles.reduce((sum, file) => sum + file.tokens, 0);
    if (seedBudget > options.budget) {
        throw new Error(
            `Explicit seed files require ${seedBudget.toLocaleString()} tokens, exceeding the available pack budget of ${options.budget.toLocaleString()} tokens. Narrow the seed paths or raise the budget.`,
        );
    }

    const warnings = [...resolved.warnings];
    const seedSet = new Set(seedFiles.map((file) => file.path));
    const relatedFiles: PackedFile[] = [];

    if (options.includeDependents) {
        const scribeTargets: ScribeTargetRequest[] = seedFiles
            .filter((file) => isScribeTarget(file.path))
            .map((file) => ({ target: file.path, includeDependents: true }));

        const context: ContextPackRepoContext = {
            projectDir,
            repoRoot,
            baseRef: "HEAD",
            baseCommit: "HEAD",
            headCommit: "HEAD",
        };

        const recall = await runScribeRecall(context, scribeTargets, relatedFilterOptions);
        warnings.push(...recall.warnings);

        const merged = new Map<string, RankedRelatedCandidate>();
        const contentCache = new Map<string, string>();

        for (const target of recall.targets) {
            for (const candidate of target.candidates) {
                const relativePath = normalizePath(candidate.path);
                if (seedSet.has(relativePath)) {
                    continue;
                }

                const decision = evaluateRelatedFile(relativePath, relatedFilterOptions);
                if (!decision.include) {
                    omittedFiles.push({ path: relativePath, reason: decision.reason ?? "filtered:unknown" });
                    continue;
                }

                const absolutePath = path.join(repoRoot, relativePath);
                if (!(await pathExists(absolutePath))) {
                    omittedFiles.push({ path: relativePath, reason: "filtered:missing" });
                    continue;
                }

                if (!(await fileIsLikelyText(absolutePath))) {
                    omittedFiles.push({ path: relativePath, reason: "filtered:binary" });
                    continue;
                }

                if (!contentCache.has(relativePath)) {
                    contentCache.set(relativePath, await readFile(absolutePath, "utf8"));
                }

                const current = merged.get(relativePath);
                merged.set(relativePath, mergeCandidate(current, { ...candidate, path: relativePath }));
            }
        }

        const candidates = rankRelatedCandidates([...merged.values()]);
        const estimatedCandidates: RankedRelatedCandidate[] = [];
        for (const candidate of candidates) {
            const absolutePath = path.join(repoRoot, candidate.path);
            const counted = await countTokensForFile(absolutePath);
            estimatedCandidates.push({
                ...candidate,
                estimatedTokens: counted.tokens,
            });
        }

        const ranked = rankRelatedCandidates(estimatedCandidates);
        const fit = fitRelatedCandidatesToBudget({
            budget: options.budget,
            baselineTokens: seedBudget,
            candidates: ranked,
        });

        for (const omitted of fit.omitted) {
            omittedFiles.push({ path: omitted.candidate.path, reason: omitted.reason });
        }

        for (const included of fit.included) {
            relatedFiles.push({
                path: included.path,
                content:
                    contentCache.get(included.path) ?? (await readFile(path.join(repoRoot, included.path), "utf8")),
                tokens: included.estimatedTokens ?? 0,
            });
        }
    }

    const markdown = renderPackMarkdown(seedFiles, relatedFiles, omittedFiles);
    await writeFile(outputPath, markdown, "utf8");
    const tokenCount = await countTokensForText(markdown);
    if (tokenCount.tokens > options.budget) {
        throw new Error(
            `Rendered context pack requires ${tokenCount.tokens.toLocaleString()} tokens, exceeding the available pack budget of ${options.budget.toLocaleString()} tokens. Narrow the seed paths or raise the budget.`,
        );
    }

    return {
        packPath: outputPath,
        projectDir,
        seedFiles,
        relatedFiles,
        omittedFiles,
        warnings,
        tokenCount,
    };
}

export async function countMarkdownTokens(markdown: string): Promise<CountTokensResult> {
    return countTokensForText(markdown);
}
```

## `extensions/pro-plan/oracle.ts`

```ts
import { execFile, spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { OracleRunOptions, OracleRunResult } from "./types.js";

const execFileAsync = promisify(execFile);

async function commandExists(command: string, args: string[]): Promise<boolean> {
    try {
        await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
        return true;
    } catch {
        return false;
    }
}

async function resolveOracleCommand(): Promise<{ command: string; prefixArgs: string[] }> {
    if (await commandExists("oracle", ["--version"])) {
        return { command: "oracle", prefixArgs: [] };
    }

    if (await commandExists("npx", ["--version"])) {
        return { command: "npx", prefixArgs: ["-y", "@steipete/oracle"] };
    }

    throw new Error("Neither `oracle` nor `npx` is available. Install Oracle or ensure npx is in PATH.");
}

function shortPrompt(): string {
    return "Read the attached planning request carefully. If a context pack is attached, use it as the source of code context. Produce only the requested planning output.";
}

export async function runOracleBrowser(options: OracleRunOptions): Promise<OracleRunResult> {
    const resolved = await resolveOracleCommand();
    const args = [
        ...resolved.prefixArgs,
        "--engine",
        "browser",
        "--model",
        "gpt-5.4-pro",
        "--browser-model-strategy",
        "select",
        "--wait",
        "--write-output",
        options.responsePath,
        "--prompt",
        shortPrompt(),
        "--file",
        options.requestPath,
    ];

    if (options.packPath) {
        args.push("--file", options.packPath);
    }

    await writeFile(
        options.logPath,
        `> ${resolved.command} ${args.map((value) => JSON.stringify(value)).join(" ")}\n\n`,
        "utf8",
    );

    return new Promise<OracleRunResult>((resolve, reject) => {
        const detached = process.platform !== "win32";
        const child = spawn(resolved.command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
            detached,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let killTimeout: ReturnType<typeof setTimeout> | null = null;

        const finish = async (result: OracleRunResult) => {
            if (settled) {
                return;
            }
            settled = true;
            await appendFile(
                options.logPath,
                `\n[exit ${result.exitCode}]\n\n[stdout]\n${result.stdout}\n\n[stderr]\n${result.stderr}\n`,
                "utf8",
            );
            resolve(result);
        };

        const fail = async (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            await appendFile(options.logPath, `\n[error]\n${error.message}\n`, "utf8");
            reject(error);
        };

        child.stdout.on("data", (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            void fail(error instanceof Error ? error : new Error(String(error)));
        });

        child.on("close", (code) => {
            if (killTimeout) {
                clearTimeout(killTimeout);
                killTimeout = null;
            }
            void finish({
                stdout,
                stderr,
                exitCode: code ?? -1,
            });
        });

        options.signal?.addEventListener(
            "abort",
            () => {
                const terminate = (signal: NodeJS.Signals): void => {
                    try {
                        if (detached && child.pid) {
                            process.kill(-child.pid, signal);
                            return;
                        }
                        child.kill(signal);
                    } catch {
                        // process already exited
                    }
                };

                terminate("SIGTERM");
                killTimeout = setTimeout(() => {
                    terminate("SIGKILL");
                }, 2000);
            },
            { once: true },
        );
    });
}

export async function readOracleResponse(responsePath: string): Promise<string> {
    const content = await readFile(responsePath, "utf8");
    return content.trim();
}
```

## `extensions/pro-plan/types.ts`

```ts
export type ProPlanMode = "pass" | "final";

export interface ProPlanContextDefaults {
    projectDir: string;
    pathSpecs: string[];
    budget: number;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
}

export interface ProPlanState {
    active: boolean;
    anchorEntryId?: string;
    artifactDir?: string;
    startedAt?: number;
    updatedAt?: number;
    passCount: number;
    latestMode?: ProPlanMode;
    latestRequestPath?: string;
    latestPackPath?: string;
    latestResponsePath?: string;
    latestLogPath?: string;
    finalResponsePath?: string;
    defaults?: ProPlanContextDefaults;
}

export interface ProPlanPassOptions {
    mode: ProPlanMode;
    prompt: string;
    projectDir: string;
    pathSpecs: string[];
    budget: number;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
    noCode: boolean;
}

export interface ParsedCommand {
    subcommand: "help" | "start" | "pass" | "final" | "apply" | "status" | "stop";
    options?: ProPlanPassOptions;
}

export interface CountTokensResult {
    tokens: number;
    method: "tokencount" | "estimate";
}

export interface PackedFile {
    path: string;
    content: string;
    tokens: number;
}

export interface OmittedFile {
    path: string;
    reason: string;
}

export interface ContextPackResult {
    packPath: string;
    projectDir: string;
    seedFiles: PackedFile[];
    relatedFiles: PackedFile[];
    omittedFiles: OmittedFile[];
    warnings: string[];
    tokenCount: CountTokensResult;
}

export interface OracleRunOptions {
    requestPath: string;
    responsePath: string;
    logPath: string;
    packPath?: string;
    signal?: AbortSignal;
}

export interface OracleRunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface ArtifactPaths {
    requestPath: string;
    responsePath: string;
    logPath: string;
    metaPath: string;
    packPath?: string;
}
```

## `extensions/pro-plan/args.test.ts`

```ts
import { describe, expect, it } from "vitest";
import { parseCommand } from "./args.js";

describe("parseCommand", () => {
    it("parses start without args", () => {
        const parsed = parseCommand("start", "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("start");
    });

    it("defaults to help when inactive", () => {
        const parsed = parseCommand("", "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("help");
    });

    it("defaults to status when active", () => {
        const parsed = parseCommand("", "/tmp/project", {
            active: true,
            passCount: 1,
            defaults: {
                projectDir: "/tmp/project",
                pathSpecs: [],
                budget: 280000,
                includeDependents: true,
                includeDocs: false,
                includeTests: false,
            },
        });
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("status");
    });

    it("parses pass with explicit code options", () => {
        const parsed = parseCommand(
            'pass --path src/foo.ts --path docs --budget 300000 --include-docs "tighten the plan"',
            "/tmp/project",
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.subcommand).toBe("pass");
        expect(parsed.options.pathSpecs).toEqual(["src/foo.ts", "docs"]);
        expect(parsed.options.budget).toBe(300000);
        expect(parsed.options.includeDocs).toBe(true);
        expect(parsed.options.prompt).toBe("tighten the plan");
    });

    it("makes explicit --path override inherited defaults", () => {
        const parsed = parseCommand('pass --path src/new-area "tighten the plan"', "/tmp/project", {
            active: true,
            passCount: 1,
            defaults: {
                projectDir: "/tmp/project",
                pathSpecs: ["src/old-area", "docs"],
                budget: 280000,
                includeDependents: true,
                includeDocs: false,
                includeTests: false,
            },
        });

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.pathSpecs).toEqual(["src/new-area"]);
    });

    it("treats no-code as overriding stored paths", () => {
        const parsed = parseCommand("pass --no-code", "/tmp/project", {
            active: true,
            passCount: 1,
            defaults: {
                projectDir: "/tmp/project",
                pathSpecs: ["src"],
                budget: 280000,
                includeDependents: true,
                includeDocs: false,
                includeTests: false,
            },
        });

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.noCode).toBe(true);
        expect(parsed.options.pathSpecs).toEqual([]);
    });

    it("rejects unknown options instead of treating them as prompt text", () => {
        const parsed = parseCommand("pass --budegt 300000 tighten things", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Unknown option: --budegt");
        }
    });
});
```

## `extensions/pro-plan/README.md`

````md
# Pro Plan

Planning workflow extension for Pi that keeps planning in the current session, checkpoints Pro passes on disk, and uses Oracle as the V1 ChatGPT Pro transport.

## What it does

- Starts a planning branch from the current session state
- Keeps planning interactive inside Pi
- Runs optional Pro passes via Oracle browser mode
- Stores request / response / log / metadata artifacts on disk
- Returns to the origin anchor and prefills the editor with the finalized plan

## Commands

- `/pro-plan start`
- `/pro-plan pass [prompt] [--path <file|dir|glob>] [--budget <tokens>] [--include-dependents] [--include-docs] [--include-tests] [--no-code]`
- `/pro-plan final [same options as pass]`
- `/pro-plan apply`
- `/pro-plan status`
- `/pro-plan stop`

## Notes

- V1 uses Oracle only as the Pro execution backend.
- Code context is explicit in V1: pass `--path` specs when you want code packed for Pro.
- If no `--path` specs are given, the pass is planning-only.
- Request/context-pack payloads stay on disk instead of being injected into Pi context.

## Requirements

Recommended:

- `oracle` on PATH, or `npx` available so the extension can run `@steipete/oracle`
- `tokencount` for better token estimates
- `npx @sibyllinesoft/scribe@1.0.4` available for related-file expansion

## Artifacts

Artifacts are written under:

```text
~/.pi/agent/pro-plan/
```
````

Typical files per pass:

- `pass-001-<timestamp>.request.md`
- `pass-001-<timestamp>.pack.md` (optional)
- `pass-001-<timestamp>.response.md`
- `pass-001-<timestamp>.oracle.log`
- `pass-001-<timestamp>.meta.json`

Finalized planning can later be applied back to the origin anchor with `/pro-plan apply`.

````
## `extensions/pro-plan/VISION.md`

```md
# VISION

`pro-plan` should make ChatGPT Pro feel native inside Pi without turning planning into a rigid wizard.

## Principles

- Planning stays human-driven and interactive.
- Pi owns the workflow, branching, artifacts, and handoff.
- The Pro backend is replaceable.
- Raw request payloads live on disk, not in session context.
- Code context is explicit first, smarter later.

## Near-term target

A reliable same-session planning branch workflow:

1. Start planning from the current session state
2. Iterate normally with Pi
3. Run one or more Pro passes with optional code context
4. Bring useful Pro output back into the planning branch
5. Return to the origin anchor and begin implementation with a clean handoff

## Longer-term target

Swap the Oracle dependency for a native Pro runner while keeping the same `/pro-plan` UX.
````

## `extensions/pro-plan/TODO.md`

```md
# TODO

## V1 follow-ups

- [ ] Add markdown renderers for help / result / error messages.
- [ ] Add a better status view than `notify()` for `/pro-plan status`.
- [ ] Reuse previous code-context defaults more explicitly in the UI.
- [ ] Warn more clearly when planning transcript alone is consuming too much of the input budget.
- [ ] Add tests for transcript building and state restoration.

## V2 direction

- [ ] Replace Oracle with a native Pro transport.
- [ ] Improve code-context sourcing beyond explicit path specs.
- [ ] Add better pass selection / artifact replay / resume UX.
```
