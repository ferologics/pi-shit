import { access, readFile, writeFile } from "node:fs/promises";
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { getDefaultBudget, parseCommand } from "./args.js";
import { buildPassRequestMarkdown, buildReturnEditorText, buildSubmissionMarkdown } from "./bundle.js";
import { artifactPaths, createArtifactDir, writeJson, writeStateFile } from "./artifacts.js";
import { buildContextPack, countMarkdownTokens } from "./context-pack.js";
import { copyTextToClipboard, readTextFromClipboard, revealFileForManualUpload } from "./manual.js";
import { buildBranchTranscript, type SessionMessageEntry } from "./transcript.js";
import type { ContextSelection, ManualHandoffStatus, PendingManualPass, ProPassOptions, ProRunState } from "./types.js";

export const PRIMARY_COMMAND = "/pro";
const STATUS_KEY = "pro";

const HELP_TEXT = `# /pro

Commands:
- /pro start
- /pro pass [prompt] [--intent <general|plan|review|architecture|debug|analyze>] [--transcript <origin|last-import|none>] [--path <file|dir|glob>] [--changed [<ref>]] [--diff [<ref>]] [--reuse-context] [--budget <tokens>] [--include-dependents] [--include-docs] [--include-tests] [--no-code]
- /pro import [response-file]
- /pro return
- /pro status
- /pro stop

Notes:
- /pro stays in the current session on its own side-thread.
- /pro start creates a non-context origin anchor and artifact directory.
- /pro pass prepares a manual ChatGPT Pro submission bundle on disk.
- Only one prepared pass can be pending import at a time.
- The submission bundle is copied to the clipboard and revealed in Finder so you can paste or drag it into a fresh ChatGPT Pro chat.
- /pro import reads the clipboard by default; pass a file path only when you want to import from disk instead.
- /pro pass and /pro import refuse to run if you have navigated off the active /pro side-thread.
- /pro pass reports whether clipboard copy and Finder reveal succeeded.
- Code context is explicit: provide --path specs, --changed, and/or --diff when you want repo context packed for Pro.
- Stored context is only reused when you pass --reuse-context.
- /pro return jumps back to the origin anchor and prefills the editor with the latest imported Pro takeaway.`;

export function defaultState(): ProRunState {
    return {
        active: false,
        passCount: 0,
        defaults: {
            projectDir: process.cwd(),
            budget: getDefaultBudget(),
            includeDependents: true,
            includeDocs: false,
            includeTests: false,
        },
    };
}

function defaultContextSelection(state: ProRunState): ContextSelection {
    return {
        transcript: "origin",
        sources: [],
        expansion: {
            dependents: state.defaults?.includeDependents ?? true,
            docs: state.defaults?.includeDocs ?? false,
            tests: state.defaults?.includeTests ?? false,
        },
        budget: state.defaults?.budget ?? getDefaultBudget(),
    };
}

function buildContextSelection(options: ProPassOptions): ContextSelection {
    const sources: ContextSelection["sources"] = [];

    if (!options.noCode && options.pathSpecs.length > 0) {
        sources.push({
            kind: "paths",
            specs: options.pathSpecs,
        });
    }

    if (!options.noCode && options.changedRef) {
        sources.push({
            kind: "changed",
            ref: options.changedRef,
        });
    }

    if (!options.noCode && options.diffRef) {
        sources.push({
            kind: "diff",
            ref: options.diffRef,
        });
    }

    return {
        transcript: options.transcriptScope,
        sources,
        expansion: {
            dependents: options.includeDependents,
            docs: options.includeDocs,
            tests: options.includeTests,
        },
        budget: options.budget,
    };
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

async function persistState(pi: ExtensionAPI, state: ProRunState): Promise<void> {
    state.updatedAt = Date.now();
    pi.appendEntry("pro-state", state);
    if (state.artifactDir) {
        await writeStateFile(state.artifactDir, state);
    }
}

export function setIdleStatus(ctx: ExtensionContext, state: ProRunState): void {
    if (!state.active) {
        ctx.ui.setStatus(STATUS_KEY, undefined);
        return;
    }

    let label =
        state.passCount > 0 ? `pro · ${state.passCount} pass${state.passCount === 1 ? "" : "es"}` : "pro · active";

    if (state.pendingPass) {
        label = `pro · waiting import (pass ${state.pendingPass.passNumber})`;
    }

    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", label));
}

function setPreparingStatus(ctx: ExtensionContext, passNumber: number): void {
    ctx.ui.setStatus(STATUS_KEY, ctx.ui.theme.fg("accent", `pro · preparing pass ${passNumber}`));
}

function describeCodeContext(options: ProPassOptions): string {
    if (options.noCode) {
        return "none (`--no-code`)";
    }

    const parts: string[] = [];
    if (options.pathSpecs.length > 0) {
        parts.push(`\`--path\` × ${options.pathSpecs.length}`);
    }
    if (options.changedRef) {
        parts.push(`\`--changed ${options.changedRef}\``);
    }
    if (options.diffRef) {
        parts.push(`\`--diff ${options.diffRef}\``);
    }

    if (parts.length === 0) {
        return "none (transcript-only pass)";
    }

    const expansion: string[] = [];
    if (options.includeDependents) {
        expansion.push("dependents");
    }
    if (options.includeDocs) {
        expansion.push("docs");
    }
    if (options.includeTests) {
        expansion.push("tests");
    }

    return expansion.length > 0 ? `${parts.join(", ")} · expand ${expansion.join(", ")}` : parts.join(", ");
}

function buildPreparationStatus(passNumber: number, options: ProPassOptions): string {
    return [
        `Preparing /pro pass ${passNumber}...`,
        "",
        `Intent: \`${options.intent}\``,
        `Transcript scope: \`${options.transcriptScope}\``,
        `Code context: ${describeCodeContext(options)}`,
        "",
        "This may take a bit while /pro counts tokens and assembles the submission bundle.",
    ].join("\n");
}

function sendHelpMessage(pi: ExtensionAPI, content: string): void {
    pi.sendMessage({
        customType: "pro-help",
        content,
        display: true,
    });
}

function sendStatusMessage(pi: ExtensionAPI, content: string): void {
    pi.sendMessage({
        customType: "pro-status",
        content,
        display: true,
    });
}

function sendErrorMessage(pi: ExtensionAPI, content: string): void {
    pi.sendMessage({
        customType: "pro-error",
        content,
        display: true,
    });
}

function formatError(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function formatHandoffStep(step: ManualHandoffStatus["clipboard"]): string {
    return step.detail;
}

function buildPreparedStatus(pendingPass: PendingManualPass, packWarnings: string[]): string {
    const warningSuffix = packWarnings.length > 0 ? ` · ${packWarnings.length} pack warning(s)` : "";

    return [
        `Prepared /pro pass ${pendingPass.passNumber} for manual ChatGPT Pro submission.${warningSuffix}`,
        "",
        `Intent: \`${pendingPass.intent}\``,
        `Transcript scope: \`${pendingPass.transcriptScope}\``,
        `Artifact family: \`${pendingPass.artifactPrefix}\``,
        `Submit bundle: \`${pendingPass.submitPath}\``,
        `Response target: \`${pendingPass.responsePath}\``,
        `Clipboard: ${formatHandoffStep(pendingPass.handoff.clipboard)}`,
        `Reveal: ${formatHandoffStep(pendingPass.handoff.reveal)}`,
        "",
        `Use a fresh ChatGPT Pro chat for this pass, submit \`${pendingPass.submitPath}\`, then copy the full response and run \`${PRIMARY_COMMAND} import\`.`,
    ].join("\n");
}

function branchContainsEntry(entries: SessionMessageEntry[], entryId: string): boolean {
    return entries.some((entry) => entry.id === entryId);
}

function inspectRunBranch(
    state: ProRunState,
    ctx: ExtensionCommandContext,
):
    | { kind: "active"; branchEntries: SessionMessageEntry[]; anchorEntryId: string }
    | { kind: "off-branch" | "broken"; message: string; anchorEntryId?: string } {
    const anchorEntryId = state.anchorEntryId;
    if (!anchorEntryId) {
        return {
            kind: "broken",
            message: "Active /pro run is missing its origin anchor. Stop the run and start a new one.",
        };
    }

    if (!ctx.sessionManager.getEntry(anchorEntryId)) {
        return {
            kind: "broken",
            anchorEntryId,
            message: `Active /pro run is broken: origin anchor \`${anchorEntryId}\` is no longer present in this session. Use \`${PRIMARY_COMMAND} stop\` and start a new run.`,
        };
    }

    const branchEntries = ctx.sessionManager.getBranch() as SessionMessageEntry[];
    if (!branchContainsEntry(branchEntries, anchorEntryId)) {
        return {
            kind: "off-branch",
            anchorEntryId,
            message: `You are not on the active /pro side-thread. Current branch does not include origin anchor \`${anchorEntryId}\`. Navigate back to the /pro side-thread, use \`${PRIMARY_COMMAND} return\`, or stop the run.`,
        };
    }

    return {
        kind: "active",
        branchEntries,
        anchorEntryId,
    };
}

function buildStatusMarkdown(state: ProRunState, branchState?: ReturnType<typeof inspectRunBranch>): string {
    if (!state.active) {
        return "# /pro status\n\nNo active /pro run.";
    }

    let branchLine = "- Branch: broken run state";
    if (branchState?.kind === "active") {
        branchLine = "- Branch: on the active /pro side-thread";
    }
    if (branchState?.kind === "off-branch") {
        branchLine = "- Branch: off the active /pro side-thread";
    }

    const lines = [
        "# /pro status",
        "",
        "## Run",
        "",
        `- State: active`,
        state.artifactDir ? `- Artifacts: \`${state.artifactDir}\`` : undefined,
        state.anchorEntryId ? `- Origin anchor: \`${state.anchorEntryId}\`` : undefined,
        `- Completed passes: ${state.passCount}`,
        branchLine,
    ].filter((line): line is string => Boolean(line));

    if (state.pendingPass) {
        lines.push(
            "",
            "## Pending import",
            "",
            `- Pass: ${state.pendingPass.passNumber}`,
            `- Intent: \`${state.pendingPass.intent}\``,
            `- Transcript scope: \`${state.pendingPass.transcriptScope}\``,
            `- Artifact family: \`${state.pendingPass.artifactPrefix}\``,
            `- Submit bundle: \`${state.pendingPass.submitPath}\``,
            `- Response target: \`${state.pendingPass.responsePath}\``,
            `- Clipboard: ${formatHandoffStep(state.pendingPass.handoff.clipboard)}`,
            `- Reveal: ${formatHandoffStep(state.pendingPass.handoff.reveal)}`,
            "",
            `Next: submit the bundle to a fresh ChatGPT Pro chat, copy the full reply, then run \`${PRIMARY_COMMAND} import\`.`,
        );
    } else {
        lines.push(
            "",
            "## Latest artifacts",
            "",
            state.latestArtifactPrefix
                ? `- Artifact family: \`${state.latestArtifactPrefix}\``
                : "- Artifact family: none yet",
            state.latestSubmitPath ? `- Submit bundle: \`${state.latestSubmitPath}\`` : "- Submit bundle: none yet",
            state.latestResponsePath
                ? `- Latest response: \`${state.latestResponsePath}\``
                : "- Latest response: none yet",
        );
    }

    if (state.lastImportEntryId) {
        lines.push("", "## Import tracking", "", `- Last import entry: \`${state.lastImportEntryId}\``);
    }

    if (branchState && branchState.kind !== "active") {
        lines.push("", "## Warning", "", branchState.message);
    }

    return lines.join("\n");
}

async function performManualHandoff(
    submissionMarkdown: string,
    submitPath: string,
    reportProgress: (detail: string) => void,
): Promise<ManualHandoffStatus> {
    let clipboard: ManualHandoffStatus["clipboard"];
    let reveal: ManualHandoffStatus["reveal"];

    reportProgress("copying submit bundle to clipboard");
    try {
        await copyTextToClipboard(submissionMarkdown);
        clipboard = {
            state: "done",
            detail: "copied",
        };
    } catch (error) {
        clipboard = {
            state: "failed",
            detail: `failed — ${formatError(error)}`,
        };
    }

    if (process.platform !== "darwin") {
        reveal = {
            state: "skipped",
            detail: `skipped on ${process.platform}`,
        };
    } else {
        reportProgress("revealing submit bundle in Finder");
        try {
            await revealFileForManualUpload(submitPath);
            reveal = {
                state: "done",
                detail: "revealed in Finder",
            };
        } catch (error) {
            reveal = {
                state: "failed",
                detail: `failed — ${formatError(error)}`,
            };
        }
    }

    return {
        clipboard,
        reveal,
    };
}

export function restoreStateFromEntries(entries: SessionMessageEntry[]): ProRunState {
    const restored = defaultState();

    for (const entry of entries) {
        if (entry.type !== "custom" || entry.customType !== "pro-state") {
            continue;
        }

        if (!entry.data || typeof entry.data !== "object") {
            continue;
        }

        Object.assign(restored, entry.data);
    }

    if (!restored.defaults) {
        restored.defaults = defaultState().defaults;
    }

    if (!restored.lastSelection) {
        restored.lastSelection = defaultContextSelection(restored);
    }

    if (restored.pendingPass && !restored.pendingPass.handoff) {
        restored.pendingPass.handoff = {
            clipboard: {
                state: "skipped",
                detail: "unknown (prepared before handoff status tracking)",
            },
            reveal: {
                state: "skipped",
                detail: "unknown (prepared before handoff status tracking)",
            },
        };
    }

    return restored;
}

async function readJson(targetPath: string): Promise<Record<string, unknown>> {
    try {
        const content = await readFile(targetPath, "utf8");
        const parsed = JSON.parse(content);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
        return {};
    }
}

async function handleStart(pi: ExtensionAPI, state: ProRunState, ctx: ExtensionCommandContext): Promise<void> {
    if (state.active) {
        ctx.ui.notify(`pro is already active${state.artifactDir ? ` · ${state.artifactDir}` : ""}`, "warning");
        return;
    }

    pi.appendEntry("pro-origin", {
        cwd: process.cwd(),
        startedAt: Date.now(),
    });

    const anchorEntryId = ctx.sessionManager.getLeafId();
    if (!anchorEntryId) {
        throw new Error("Failed to capture /pro origin entry id.");
    }

    pi.setLabel(anchorEntryId, "pro-origin");
    const artifactDir = await createArtifactDir(anchorEntryId);

    state.active = true;
    state.anchorEntryId = anchorEntryId;
    state.artifactDir = artifactDir;
    state.startedAt = Date.now();
    state.passCount = 0;
    state.latestArtifactPrefix = undefined;
    state.latestRequestPath = undefined;
    state.latestPackPath = undefined;
    state.latestSubmitPath = undefined;
    state.latestResponsePath = undefined;
    state.lastImportEntryId = undefined;
    state.pendingPass = undefined;
    state.lastSelection = undefined;
    state.defaults = {
        projectDir: process.cwd(),
        budget: getDefaultBudget(),
        includeDependents: true,
        includeDocs: false,
        includeTests: false,
    };

    await persistState(pi, state);
    setIdleStatus(ctx, state);

    pi.sendMessage({
        customType: "pro-status",
        content: `Started ${PRIMARY_COMMAND}.\n\nArtifacts: \`${artifactDir}\``,
        display: true,
    });
    ctx.ui.notify("/pro started", "info");
}

async function prepareSubmissionArtifacts(
    options: ProPassOptions,
    state: ProRunState,
    branchEntries: SessionMessageEntry[],
    reportProgress: (detail: string) => void,
): Promise<{
    pendingPass: PendingManualPass;
    requestTokens: Awaited<ReturnType<typeof countMarkdownTokens>>;
    packWarnings: string[];
}> {
    reportProgress("capturing transcript");
    const requestedContextSelection = buildContextSelection(options);
    const transcript = buildBranchTranscript({
        entries: branchEntries,
        anchorEntryId: state.anchorEntryId,
        lastImportEntryId: state.lastImportEntryId,
        scope: options.transcriptScope,
    });
    const resolvedContextSelection: ContextSelection = {
        ...requestedContextSelection,
        transcript: transcript.resolvedScope,
    };

    reportProgress("building request bundle");
    const requestMarkdown = buildPassRequestMarkdown({
        intent: options.intent,
        prompt: options.prompt,
        transcript: transcript.markdown,
        transcriptScope: transcript.resolvedScope,
        transcriptNotes: transcript.notes,
    });
    reportProgress("counting request tokens");
    const requestTokens = await countMarkdownTokens(requestMarkdown);
    if (requestTokens.tokens >= options.budget) {
        throw new Error(
            `Branch transcript and pass prompt already consume ${requestTokens.tokens.toLocaleString()} tokens, leaving no room inside the configured budget of ${options.budget.toLocaleString()} tokens. Compact the side-thread, narrow the transcript, or raise the budget.`,
        );
    }

    const passNumber = state.passCount + 1;
    const shouldUseCode = Boolean(
        !options.noCode && (options.pathSpecs.length > 0 || options.changedRef || options.diffRef),
    );
    const paths = artifactPaths(state.artifactDir!, passNumber, shouldUseCode);
    reportProgress("writing request artifact");
    await writeFile(paths.requestPath, requestMarkdown, "utf8");

    let packResult: Awaited<ReturnType<typeof buildContextPack>> | undefined;
    let packWarnings: string[] = [...transcript.notes];
    let packMarkdown: string | undefined;

    if (shouldUseCode && paths.packPath) {
        const packBudget = options.budget - requestTokens.tokens;
        reportProgress("packing code context");
        packResult = await buildContextPack(
            {
                ...options,
                budget: packBudget,
            },
            paths.packPath,
        );
        packWarnings = [...packWarnings, ...packResult.warnings];
        reportProgress("loading packed context");
        packMarkdown = await readFile(paths.packPath, "utf8");
    }

    reportProgress("assembling submit bundle");
    const submissionMarkdown = buildSubmissionMarkdown(requestMarkdown, packMarkdown);
    await writeFile(paths.submitPath, submissionMarkdown, "utf8");
    const handoff = await performManualHandoff(submissionMarkdown, paths.submitPath, reportProgress);

    state.defaults = {
        projectDir: options.projectDir,
        budget: options.budget,
        includeDependents: options.includeDependents,
        includeDocs: options.includeDocs,
        includeTests: options.includeTests,
    };
    state.lastSelection = requestedContextSelection;

    const pendingPass: PendingManualPass = {
        passNumber,
        artifactPrefix: paths.artifactPrefix,
        prompt: options.prompt,
        intent: options.intent,
        transcriptScope: options.transcriptScope,
        contextSelection: requestedContextSelection,
        requestPath: paths.requestPath,
        responsePath: paths.responsePath,
        metaPath: paths.metaPath,
        submitPath: paths.submitPath,
        preparedAt: Date.now(),
        handoff,
        packPath: paths.packPath,
    };

    reportProgress("writing pass metadata");
    await writeJson(paths.metaPath, {
        passNumber,
        artifactPrefix: paths.artifactPrefix,
        status: "pending-import",
        preparedAt: new Date(pendingPass.preparedAt).toISOString(),
        intent: options.intent,
        prompt: options.prompt,
        requestTokens,
        requestedContextSelection,
        resolvedContextSelection,
        transcriptNotes: transcript.notes,
        packTokens: packResult?.tokenCount,
        packWarnings,
        handoff,
        resolvedPaths: {
            seedFiles: packResult?.seedFiles.map((file) => file.path) ?? [],
            relatedFiles: packResult?.relatedFiles.map((file) => file.path) ?? [],
            omittedFiles: packResult?.omittedFiles ?? [],
            diffRef: packResult?.diffRef,
        },
        paths,
    });

    return {
        pendingPass,
        requestTokens,
        packWarnings,
    };
}

async function handlePass(
    pi: ExtensionAPI,
    state: ProRunState,
    ctx: ExtensionCommandContext,
    options: ProPassOptions,
): Promise<void> {
    if (!state.active || !state.anchorEntryId || !state.artifactDir) {
        sendErrorMessage(pi, `No active /pro run. Start one with ${PRIMARY_COMMAND} start.`);
        return;
    }

    if (state.pendingPass) {
        sendErrorMessage(
            pi,
            `A /pro submission is already waiting for ${PRIMARY_COMMAND} import. Use the existing submit bundle, then run ${PRIMARY_COMMAND} import, or run ${PRIMARY_COMMAND} stop to abandon this run.`,
        );
        return;
    }

    const branchState = inspectRunBranch(state, ctx);
    if (branchState.kind !== "active") {
        sendErrorMessage(pi, branchState.message);
        return;
    }

    const passNumber = state.passCount + 1;
    setPreparingStatus(ctx, passNumber);
    pi.sendMessage({
        customType: "pro-status",
        content: buildPreparationStatus(passNumber, options),
        display: true,
    });
    ctx.ui.notify(`/pro pass ${passNumber}: preparing submission bundle`, "info");

    const reportProgress = (detail: string): void => {
        ctx.ui.setWorkingMessage(`preparing /pro pass ${passNumber}: ${detail}...`);
        setPreparingStatus(ctx, passNumber);
    };

    try {
        reportProgress("capturing transcript");
        const prepared = await prepareSubmissionArtifacts(options, state, branchState.branchEntries, reportProgress);
        state.pendingPass = prepared.pendingPass;
        state.latestArtifactPrefix = prepared.pendingPass.artifactPrefix;
        state.latestRequestPath = prepared.pendingPass.requestPath;
        state.latestPackPath = prepared.pendingPass.packPath;
        state.latestSubmitPath = prepared.pendingPass.submitPath;
        await persistState(pi, state);
        setIdleStatus(ctx, state);

        const warningSuffix =
            prepared.packWarnings.length > 0 ? ` · ${prepared.packWarnings.length} pack warning(s)` : "";
        sendStatusMessage(pi, buildPreparedStatus(prepared.pendingPass, prepared.packWarnings));
        ctx.ui.notify(`/pro pass ready for manual submit${warningSuffix}`, "info");
    } finally {
        ctx.ui.setWorkingMessage();
        setIdleStatus(ctx, state);
    }
}

async function handleImport(
    pi: ExtensionAPI,
    state: ProRunState,
    ctx: ExtensionCommandContext,
    inputPath?: string,
): Promise<void> {
    if (!state.active || !state.pendingPass) {
        sendErrorMessage(
            pi,
            `No /pro submission is waiting for import. Prepare one first with ${PRIMARY_COMMAND} pass.`,
        );
        return;
    }

    const branchState = inspectRunBranch(state, ctx);
    if (branchState.kind !== "active") {
        sendErrorMessage(pi, branchState.message);
        return;
    }

    const responseText = (inputPath ? await readFile(inputPath, "utf8") : await readTextFromClipboard()).trim();
    if (!responseText) {
        throw new Error(inputPath ? `Imported response file was empty: ${inputPath}` : "Clipboard response was empty");
    }

    const pending = state.pendingPass;
    await writeFile(pending.responsePath, `${responseText}\n`, "utf8");

    const meta = await readJson(pending.metaPath);
    await writeJson(pending.metaPath, {
        ...meta,
        status: "imported",
        importedAt: new Date().toISOString(),
        importSource: inputPath ? { type: "file", path: inputPath } : { type: "clipboard" },
        responseBytes: Buffer.byteLength(responseText, "utf8"),
    });

    state.passCount = pending.passNumber;
    state.latestArtifactPrefix = pending.artifactPrefix;
    state.latestRequestPath = pending.requestPath;
    state.latestPackPath = pending.packPath;
    state.latestSubmitPath = pending.submitPath;
    state.latestResponsePath = pending.responsePath;
    state.pendingPass = undefined;

    pi.sendMessage({
        customType: "pro-response",
        content: responseText,
        display: true,
    });
    state.lastImportEntryId = ctx.sessionManager.getLeafId() ?? state.lastImportEntryId;

    await persistState(pi, state);
    setIdleStatus(ctx, state);
    ctx.ui.notify("/pro response imported", "info");
}

async function handleReturn(pi: ExtensionAPI, state: ProRunState, ctx: ExtensionCommandContext): Promise<void> {
    if (!state.active || !state.anchorEntryId) {
        sendErrorMessage(pi, "No active /pro run to return from.");
        return;
    }

    const branchState = inspectRunBranch(state, ctx);
    if (branchState.kind === "broken") {
        sendErrorMessage(pi, branchState.message);
        return;
    }

    if (!(await fileExists(state.latestResponsePath))) {
        sendErrorMessage(pi, `No imported /pro response is available to return. Run ${PRIMARY_COMMAND} import first.`);
        return;
    }

    const response = await readFile(state.latestResponsePath!, "utf8");
    await ctx.navigateTree(state.anchorEntryId, {
        summarize: false,
        label: "pro-origin",
    });

    ctx.ui.setEditorText(buildReturnEditorText(response));
    state.active = false;
    state.pendingPass = undefined;
    await persistState(pi, state);
    setIdleStatus(ctx, state);
    ctx.ui.notify("Returned to the /pro origin and filled the editor with the latest takeaway", "info");
}

async function handleStatus(pi: ExtensionAPI, state: ProRunState, ctx: ExtensionCommandContext): Promise<void> {
    const branchState = state.active ? inspectRunBranch(state, ctx) : undefined;
    sendStatusMessage(pi, buildStatusMarkdown(state, branchState));
}

async function handleStop(pi: ExtensionAPI, state: ProRunState, ctx: ExtensionCommandContext): Promise<void> {
    if (!state.active) {
        ctx.ui.notify("No active /pro run", "info");
        return;
    }

    const hadPendingImport = Boolean(state.pendingPass);
    state.active = false;
    state.pendingPass = undefined;
    await persistState(pi, state);
    setIdleStatus(ctx, state);
    ctx.ui.notify(hadPendingImport ? "/pro stopped and pending import cleared" : "/pro stopped", "info");
}

export async function handleCommand(
    pi: ExtensionAPI,
    state: ProRunState,
    ctx: ExtensionCommandContext,
    rawArgs: string,
): Promise<void> {
    try {
        const parsed = parseCommand(rawArgs, process.cwd(), state);
        if ("error" in parsed) {
            sendErrorMessage(pi, `${parsed.error}\n\nUse ${PRIMARY_COMMAND} help for usage.`);
            return;
        }

        if (parsed.subcommand === "help") {
            sendHelpMessage(pi, HELP_TEXT);
            return;
        }

        if (parsed.subcommand === "start") {
            await handleStart(pi, state, ctx);
            return;
        }

        if (parsed.subcommand === "status") {
            await handleStatus(pi, state, ctx);
            return;
        }

        if (parsed.subcommand === "stop") {
            await handleStop(pi, state, ctx);
            return;
        }

        if (parsed.subcommand === "import") {
            await handleImport(pi, state, ctx, parsed.inputPath);
            return;
        }

        if (parsed.subcommand === "return") {
            await handleReturn(pi, state, ctx);
            return;
        }

        await handlePass(pi, state, ctx, parsed.options!);
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        sendErrorMessage(pi, `/pro failed: ${message}`);
        ctx.ui.notify("/pro failed", "error");
    }
}
