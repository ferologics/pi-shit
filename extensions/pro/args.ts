import path from "node:path";
import type {
    ContextSelection,
    ParsedCommand,
    ProIntent,
    ProPassOptions,
    ProRunState,
    TranscriptScope,
} from "./types.js";

const DEFAULT_BUDGET = 280000;
const VALID_INTENTS: ProIntent[] = ["general", "plan", "review", "architecture", "debug", "analyze"];
const VALID_TRANSCRIPT_SCOPES: TranscriptScope[] = ["origin", "last-import", "none"];

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

function buildDefaults(cwd: string, state: ProRunState | undefined): ProPassOptions {
    return {
        prompt: "",
        intent: "general",
        transcriptScope: "origin",
        projectDir: state?.defaults?.projectDir ?? cwd,
        pathSpecs: [],
        changedRef: undefined,
        diffRef: undefined,
        budget: state?.defaults?.budget ?? DEFAULT_BUDGET,
        includeDependents: state?.defaults?.includeDependents ?? true,
        includeDocs: state?.defaults?.includeDocs ?? false,
        includeTests: state?.defaults?.includeTests ?? false,
        noCode: false,
        reuseContext: false,
    };
}

function pathSpecsFromSelection(selection: ContextSelection | undefined): string[] {
    if (!selection) {
        return [];
    }

    return selection.sources.flatMap((source) => (source.kind === "paths" ? source.specs : []));
}

function changedRefFromSelection(selection: ContextSelection | undefined): string | undefined {
    const source = selection?.sources.find(
        (entry): entry is Extract<ContextSelection["sources"][number], { kind: "changed" }> => entry.kind === "changed",
    );
    return source?.ref;
}

function diffRefFromSelection(selection: ContextSelection | undefined): string | undefined {
    const source = selection?.sources.find(
        (entry): entry is Extract<ContextSelection["sources"][number], { kind: "diff" }> => entry.kind === "diff",
    );
    return source?.ref;
}

function applyLastSelection(
    options: ProPassOptions,
    state: ProRunState | undefined,
    preserve: {
        pathSpecs: boolean;
        changedRef: boolean;
        diffRef: boolean;
        transcriptScope: boolean;
        budget: boolean;
        includeDependents: boolean;
        includeDocs: boolean;
        includeTests: boolean;
    },
): void {
    const selection = state?.lastSelection;
    if (!selection) {
        return;
    }

    if (!preserve.transcriptScope) {
        options.transcriptScope = selection.transcript;
    }
    if (!preserve.pathSpecs) {
        options.pathSpecs = [...pathSpecsFromSelection(selection)];
    }
    if (!preserve.changedRef) {
        options.changedRef = changedRefFromSelection(selection);
    }
    if (!preserve.diffRef) {
        options.diffRef = diffRefFromSelection(selection);
    }
    if (!preserve.includeDependents) {
        options.includeDependents = selection.expansion.dependents;
    }
    if (!preserve.includeDocs) {
        options.includeDocs = selection.expansion.docs;
    }
    if (!preserve.includeTests) {
        options.includeTests = selection.expansion.tests;
    }
    if (!preserve.budget) {
        options.budget = selection.budget;
    }
}

function parseIntent(value: string): ProIntent | undefined {
    return VALID_INTENTS.find((intent) => intent === value);
}

function parseTranscriptScope(value: string): TranscriptScope | undefined {
    return VALID_TRANSCRIPT_SCOPES.find((scope) => scope === value);
}

function optionalRef(next: string | undefined): { ref: string; consumed: boolean } {
    if (!next || next.startsWith("-")) {
        return {
            ref: "HEAD",
            consumed: false,
        };
    }

    return {
        ref: next,
        consumed: true,
    };
}

export function getDefaultBudget(): number {
    return DEFAULT_BUDGET;
}

export function parseCommand(rawArgs: string, cwd: string, state?: ProRunState): ParsedCommand | { error: string } {
    const tokens = splitArgs(rawArgs);
    const [subcommandRaw, ...rest] = tokens;
    const defaultSubcommand = state?.active ? "status" : "help";
    const subcommand = (subcommandRaw ?? defaultSubcommand).toLowerCase();

    if (["help", "--help", "-h"].includes(subcommand)) {
        return { subcommand: "help" };
    }

    if (["start", "return", "status", "stop"].includes(subcommand)) {
        return { subcommand: subcommand as ParsedCommand["subcommand"] };
    }

    if (subcommand === "import") {
        const [inputPath, ...restAfterPath] = rest;
        if (inputPath?.startsWith("-")) {
            return { error: `Unknown option: ${inputPath}` };
        }
        for (const token of restAfterPath) {
            if (token.startsWith("-")) {
                return { error: `Unknown option: ${token}` };
            }
            return { error: "Import accepts at most one optional file path" };
        }

        return {
            subcommand: "import",
            inputPath: inputPath ? path.resolve(cwd, inputPath) : undefined,
        };
    }

    if (subcommand !== "pass") {
        return { error: `Unknown subcommand: ${subcommandRaw ?? ""}`.trim() };
    }

    const options = buildDefaults(cwd, state);
    const positional: string[] = [];
    let sawExplicitPath = false;
    let sawExplicitChanged = false;
    let sawExplicitDiff = false;
    let sawExplicitTranscript = false;
    let sawExplicitBudget = false;
    let sawExplicitDependents = false;
    let sawExplicitDocs = false;
    let sawExplicitTests = false;

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
                sawExplicitBudget = true;
                index += 1;
                break;
            }
            case "--changed": {
                const parsed = optionalRef(next);
                options.changedRef = parsed.ref;
                sawExplicitChanged = true;
                if (parsed.consumed) {
                    index += 1;
                }
                break;
            }
            case "--diff": {
                const parsed = optionalRef(next);
                options.diffRef = parsed.ref;
                sawExplicitDiff = true;
                if (parsed.consumed) {
                    index += 1;
                }
                break;
            }
            case "--intent": {
                if (!next) {
                    return { error: `${token} requires a value` };
                }
                const intent = parseIntent(next);
                if (!intent) {
                    return { error: `Invalid intent: ${next}` };
                }
                options.intent = intent;
                index += 1;
                break;
            }
            case "--transcript": {
                if (!next) {
                    return { error: `${token} requires a value` };
                }
                const scope = parseTranscriptScope(next);
                if (!scope) {
                    return { error: `Invalid transcript scope: ${next}` };
                }
                options.transcriptScope = scope;
                sawExplicitTranscript = true;
                index += 1;
                break;
            }
            case "--reuse-context": {
                options.reuseContext = true;
                break;
            }
            case "--no-code": {
                options.noCode = true;
                break;
            }
            case "--include-dependents": {
                options.includeDependents = true;
                sawExplicitDependents = true;
                break;
            }
            case "--no-dependents": {
                options.includeDependents = false;
                sawExplicitDependents = true;
                break;
            }
            case "--include-docs": {
                options.includeDocs = true;
                sawExplicitDocs = true;
                break;
            }
            case "--include-tests": {
                options.includeTests = true;
                sawExplicitTests = true;
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

    if (options.reuseContext) {
        applyLastSelection(options, state, {
            pathSpecs: sawExplicitPath,
            changedRef: sawExplicitChanged,
            diffRef: sawExplicitDiff,
            transcriptScope: sawExplicitTranscript,
            budget: sawExplicitBudget,
            includeDependents: sawExplicitDependents,
            includeDocs: sawExplicitDocs,
            includeTests: sawExplicitTests,
        });
    }

    if (options.noCode) {
        options.pathSpecs = [];
        options.changedRef = undefined;
        options.diffRef = undefined;
    }

    options.pathSpecs = [
        ...new Set(options.pathSpecs.map((value) => value.trim()).filter((value) => value.length > 0)),
    ];

    return {
        subcommand: "pass",
        options,
    };
}
