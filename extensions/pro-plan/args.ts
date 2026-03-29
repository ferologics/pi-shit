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
