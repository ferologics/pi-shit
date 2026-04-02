import { describe, expect, it } from "vitest";
import { buildBranchTranscript, type SessionMessageEntry } from "./transcript.js";

function buildEntries(): SessionMessageEntry[] {
    return [
        {
            type: "custom",
            id: "origin00",
            customType: "pro-origin",
            data: { startedAt: 1 },
        },
        {
            type: "message",
            id: "user001",
            message: {
                role: "user",
                content: [{ type: "text", text: "first user request" }],
            },
        },
        {
            type: "message",
            id: "asst001",
            message: {
                role: "assistant",
                content: [{ type: "text", text: "first assistant reply" }],
            },
        },
        {
            type: "custom_message",
            id: "import01",
            customType: "pro-response",
            content: [{ type: "text", text: "imported answer" }],
        },
        {
            type: "message",
            id: "user002",
            message: {
                role: "user",
                content: [{ type: "text", text: "follow-up question" }],
            },
        },
    ];
}

describe("buildBranchTranscript", () => {
    it("builds the origin transcript from the anchor", () => {
        const result = buildBranchTranscript({
            entries: buildEntries(),
            anchorEntryId: "origin00",
            scope: "origin",
        });

        expect(result.resolvedScope).toBe("origin");
        expect(result.notes).toEqual([]);
        expect(result.markdown).toContain("## User\nfirst user request");
        expect(result.markdown).toContain("## Pi side-thread assistant\nfirst assistant reply");
        expect(result.markdown).toContain("## Imported Pro response\nimported answer");
        expect(result.markdown).toContain("## User\nfollow-up question");
    });

    it("builds an empty transcript for scope none", () => {
        const result = buildBranchTranscript({
            entries: buildEntries(),
            anchorEntryId: "origin00",
            scope: "none",
        });

        expect(result.resolvedScope).toBe("none");
        expect(result.notes).toEqual([]);
        expect(result.markdown).toBe("");
    });

    it("builds the last-import transcript from the last imported response", () => {
        const result = buildBranchTranscript({
            entries: buildEntries(),
            anchorEntryId: "origin00",
            lastImportEntryId: "import01",
            scope: "last-import",
        });

        expect(result.resolvedScope).toBe("last-import");
        expect(result.notes).toEqual([]);
        expect(result.markdown).not.toContain("first user request");
        expect(result.markdown).not.toContain("imported answer");
        expect(result.markdown).toContain("follow-up question");
    });

    it("falls back to origin when last-import has no imported response yet", () => {
        const result = buildBranchTranscript({
            entries: buildEntries(),
            anchorEntryId: "origin00",
            scope: "last-import",
        });

        expect(result.resolvedScope).toBe("origin");
        expect(result.notes[0]).toContain("fell back to `origin`");
        expect(result.markdown).toContain("first user request");
    });
});
