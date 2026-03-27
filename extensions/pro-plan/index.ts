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

    const passNumber = state.passCount + 1;
    const shouldUseCode = !options.noCode && options.pathSpecs.length > 0;
    const paths = artifactPaths(state.artifactDir, passNumber, options.mode, shouldUseCode);
    await writeFile(paths.requestPath, requestMarkdown, "utf8");

    let packResult: Awaited<ReturnType<typeof buildPlanningContextPack>> | undefined;
    let packWarnings: string[] = [];

    if (shouldUseCode && paths.packPath) {
        const packBudget = Math.max(8192, options.budget - requestTokens.tokens);
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
