export type SessionMessageEntry = {
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

interface BuildBranchTranscriptOptions {
    entries: SessionMessageEntry[];
    anchorEntryId?: string;
    lastImportEntryId?: string;
    scope: "origin" | "last-import" | "none";
}

export interface BranchTranscriptResult {
    markdown: string;
    resolvedScope: "origin" | "last-import" | "none";
    notes: string[];
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

function findEntryIndex(entries: SessionMessageEntry[], entryId: string | undefined): number {
    if (!entryId) {
        return -1;
    }

    return entries.findIndex((entry) => entry.id === entryId);
}

function resolveStartIndex(
    entries: SessionMessageEntry[],
    anchorEntryId: string | undefined,
    lastImportEntryId: string | undefined,
    scope: "origin" | "last-import" | "none",
): { startIndex: number; resolvedScope: "origin" | "last-import" | "none"; notes: string[] } {
    if (scope === "none") {
        return {
            startIndex: entries.length,
            resolvedScope: "none",
            notes: [],
        };
    }

    if (scope === "last-import") {
        const lastImportIndex = findEntryIndex(entries, lastImportEntryId);
        if (lastImportIndex >= 0) {
            return {
                startIndex: lastImportIndex + 1,
                resolvedScope: "last-import",
                notes: [],
            };
        }

        const anchorIndex = findEntryIndex(entries, anchorEntryId);
        return {
            startIndex: anchorIndex >= 0 ? anchorIndex + 1 : 0,
            resolvedScope: "origin",
            notes: [
                "Requested transcript scope `last-import`, but no prior imported Pro response was available, so the transcript fell back to `origin`.",
            ],
        };
    }

    const anchorIndex = findEntryIndex(entries, anchorEntryId);
    return {
        startIndex: anchorIndex >= 0 ? anchorIndex + 1 : 0,
        resolvedScope: "origin",
        notes: [],
    };
}

export function buildBranchTranscript(options: BuildBranchTranscriptOptions): BranchTranscriptResult {
    const resolved = resolveStartIndex(
        options.entries,
        options.anchorEntryId,
        options.lastImportEntryId,
        options.scope,
    );
    const relevantEntries = options.entries.slice(resolved.startIndex);
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
                lines.push(`## Pi side-thread assistant\n${text}`);
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

        if (entry.type === "custom_message" && entry.customType === "pro-response") {
            const text = extractText(entry.content);
            if (!text) {
                continue;
            }

            lines.push(`## Imported Pro response\n${text}`);
        }
    }

    return {
        markdown: lines.join("\n\n").trim(),
        resolvedScope: resolved.resolvedScope,
        notes: resolved.notes,
    };
}
