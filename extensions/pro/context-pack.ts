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
import type { ContextPackResult, CountTokensResult, OmittedFile, PackedFile, ProPassOptions } from "./types.js";

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

function createFilterOptions(projectDir: string, input: ProPassOptions, related: boolean): ContextPackOptions {
    return {
        projectDir,
        baseRef: "HEAD",
        budget: input.budget,
        outputName: "pro-pack",
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

async function resolveChangedFiles(repoRoot: string, ref: string): Promise<{ files: string[]; warnings: string[] }> {
    const warnings: string[] = [];

    try {
        const args = ["-C", repoRoot, "diff", "--name-only", "--diff-filter=ACMR"];
        if (ref === "HEAD") {
            args.push("HEAD");
        } else {
            args.push(`${ref}...HEAD`);
        }

        const result = await execFileAsync("git", args, {
            maxBuffer: EXEC_MAX_BUFFER,
        });

        const files = result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => path.resolve(repoRoot, line));

        if (files.length === 0) {
            warnings.push(`Changed source matched no files for ref: ${ref}`);
        }

        return { files, warnings };
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to resolve changed files for ref ${ref}: ${message}`);
    }
}

async function resolveDiffText(repoRoot: string, ref: string): Promise<string> {
    try {
        const args = ["-C", repoRoot, "diff", "--no-ext-diff", "--submodule=diff"];
        if (ref === "HEAD") {
            args.push("HEAD");
        } else {
            args.push(`${ref}...HEAD`);
        }

        const result = await execFileAsync("git", args, {
            maxBuffer: EXEC_MAX_BUFFER,
        });
        return result.stdout.trim();
    } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to build diff for ref ${ref}: ${message}`);
    }
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
    const scratchDir = await mkdtemp(path.join(os.tmpdir(), "pro-token-"));
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

function appendDiff(lines: string[], diffText: string | undefined, diffRef: string | undefined): void {
    const normalized = diffText?.trim() ?? "";
    const title = diffRef ? `## Diff (${diffRef})` : "## Diff";

    lines.push(title);
    lines.push("");

    if (!normalized) {
        lines.push("None");
        lines.push("");
        return;
    }

    const fence = codeFenceFor(normalized);
    lines.push(fence);
    lines.push(normalized);
    if (!normalized.endsWith("\n")) {
        lines.push("");
    }
    lines.push(fence);
    lines.push("");
}

function renderPackMarkdown(
    seedFiles: PackedFile[],
    relatedFiles: PackedFile[],
    omittedFiles: OmittedFile[],
    diffText?: string,
    diffRef?: string,
): string {
    const lines: string[] = [];

    lines.push("# Pro Context Pack");
    lines.push("");
    lines.push(`- Generated: ${new Date().toISOString()}`);
    lines.push(`- Seed files: ${seedFiles.length}`);
    lines.push(`- Related files: ${relatedFiles.length}`);
    lines.push(`- Omitted files: ${omittedFiles.length}`);
    lines.push(`- Includes diff: ${diffText?.trim() ? "yes" : "no"}`);
    lines.push("");

    appendDiff(lines, diffText, diffRef);
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

export async function buildContextPack(options: ProPassOptions, outputPath: string): Promise<ContextPackResult> {
    if (options.pathSpecs.length === 0 && !options.changedRef && !options.diffRef) {
        throw new Error("No code context was selected for this code-backed pass.");
    }

    const projectDir = path.resolve(options.projectDir);
    const repoRoot = await resolveRepoRoot(projectDir);
    const seedFilterOptions = createFilterOptions(projectDir, options, false);
    const relatedFilterOptions = createFilterOptions(projectDir, options, true);
    const omittedFiles: OmittedFile[] = [];
    const warnings: string[] = [];

    const resolvedPaths = await resolvePathSpecs(projectDir, options.pathSpecs);
    warnings.push(...resolvedPaths.warnings);

    const changedFiles = options.changedRef
        ? await resolveChangedFiles(repoRoot, options.changedRef)
        : { files: [], warnings: [] };
    warnings.push(...changedFiles.warnings);

    const seedAbsolutePaths = new Set<string>(
        [...resolvedPaths.files, ...changedFiles.files].map((file) => path.resolve(file)),
    );

    const seedFiles: PackedFile[] = [];
    for (const absolutePath of [...seedAbsolutePaths].sort()) {
        const relativePath = normalizePath(path.relative(repoRoot, absolutePath));
        const decision = evaluateChangedFile(relativePath, seedFilterOptions);
        if (!decision.include) {
            omittedFiles.push({ path: relativePath, reason: decision.reason ?? "filtered:unknown" });
            continue;
        }

        if (!(await pathExists(absolutePath))) {
            omittedFiles.push({ path: relativePath, reason: "filtered:missing" });
            continue;
        }

        if (!(await fileIsLikelyText(absolutePath))) {
            omittedFiles.push({ path: relativePath, reason: "filtered:binary" });
            continue;
        }

        seedFiles.push(await loadPackedFile(repoRoot, absolutePath));
    }

    const diffText = options.diffRef ? await resolveDiffText(repoRoot, options.diffRef) : undefined;
    if (options.diffRef && !diffText) {
        warnings.push(`Diff source matched no hunks for ref: ${options.diffRef}`);
    }

    if (seedFiles.length === 0 && !diffText) {
        throw new Error(
            "No code context was eligible after resolving the selected sources. Adjust --path / --changed / --diff inputs or disable code packing.",
        );
    }

    const seedBudget = seedFiles.reduce((sum, file) => sum + file.tokens, 0);
    const diffTokens = diffText ? await countTokensForText(diffText) : { tokens: 0, method: "estimate" as const };
    const baselineTokens = seedBudget + diffTokens.tokens;
    if (baselineTokens > options.budget) {
        throw new Error(
            `Selected code context requires ${baselineTokens.toLocaleString()} tokens, exceeding the available pack budget of ${options.budget.toLocaleString()} tokens. Narrow the selected sources or raise the budget.`,
        );
    }

    const seedSet = new Set(seedFiles.map((file) => file.path));
    const relatedFiles: PackedFile[] = [];

    if (options.includeDependents && seedFiles.length > 0) {
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
            baselineTokens,
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

    const markdown = renderPackMarkdown(seedFiles, relatedFiles, omittedFiles, diffText, options.diffRef);
    await writeFile(outputPath, markdown, "utf8");
    const tokenCount = await countTokensForText(markdown);
    if (tokenCount.tokens > options.budget) {
        throw new Error(
            `Rendered context pack requires ${tokenCount.tokens.toLocaleString()} tokens, exceeding the available pack budget of ${options.budget.toLocaleString()} tokens. Narrow the selected sources or raise the budget.`,
        );
    }

    return {
        packPath: outputPath,
        projectDir,
        seedFiles,
        relatedFiles,
        omittedFiles,
        diffText,
        diffRef: options.diffRef,
        warnings,
        tokenCount,
    };
}

export async function countMarkdownTokens(markdown: string): Promise<CountTokensResult> {
    return countTokensForText(markdown);
}
