import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
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
        const handle = await readFile(filePath);
        const length = Math.min(handle.length, 8192);
        for (let index = 0; index < length; index += 1) {
            if (handle[index] === 0) {
                return false;
            }
        }
        return true;
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
        const result = await execFileAsync("rg", ["--files", projectDir, "-g", spec], {
            maxBuffer: EXEC_MAX_BUFFER,
        });
        return result.stdout
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter((line) => line.length > 0)
            .map((line) => path.join(projectDir, line));
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

function renderPackMarkdown(seedFiles: PackedFile[], relatedFiles: PackedFile[], omittedFiles: OmittedFile[]): string {
    const lines: string[] = [];

    lines.push("# Pro Plan Context Pack");
    lines.push("");
    lines.push(`- Generated: ${new Date().toISOString()}`);
    lines.push(`- Seed files: ${seedFiles.length}`);
    lines.push(`- Related files: ${relatedFiles.length}`);
    lines.push(`- Omitted files: ${omittedFiles.length}`);
    lines.push("");

    lines.push(`## Seed files (${seedFiles.length})`);
    lines.push("");
    for (const file of seedFiles) {
        lines.push(`### ${file.path}`);
        lines.push("");
        lines.push("```");
        lines.push(file.content);
        if (!file.content.endsWith("\n")) {
            lines.push("");
        }
        lines.push("```");
        lines.push("");
    }

    if (seedFiles.length === 0) {
        lines.push("None");
        lines.push("");
    }

    lines.push(`## Related files (${relatedFiles.length})`);
    lines.push("");
    for (const file of relatedFiles) {
        lines.push(`### ${file.path}`);
        lines.push("");
        lines.push("```");
        lines.push(file.content);
        if (!file.content.endsWith("\n")) {
            lines.push("");
        }
        lines.push("```");
        lines.push("");
    }

    if (relatedFiles.length === 0) {
        lines.push("None");
        lines.push("");
    }

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
