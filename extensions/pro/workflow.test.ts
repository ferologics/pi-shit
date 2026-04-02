import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const testState = vi.hoisted(() => ({
    tempRoot: "",
    artifactCounter: 0,
    clipboardText: "",
    copyShouldFail: false,
    revealShouldFail: false,
    buildContextPackCalls: [] as Array<{ options: Record<string, unknown>; outputPath: string }>,
}));

vi.mock("./manual.js", () => ({
    copyTextToClipboard: vi.fn(async (text: string) => {
        if (testState.copyShouldFail) {
            throw new Error("copy nope");
        }
        testState.clipboardText = text;
    }),
    readTextFromClipboard: vi.fn(async () => testState.clipboardText),
    revealFileForManualUpload: vi.fn(async () => {
        if (testState.revealShouldFail) {
            throw new Error("reveal nope");
        }
    }),
}));

vi.mock("./context-pack.js", async () => {
    const { writeFile } = await import("node:fs/promises");

    return {
        countMarkdownTokens: vi.fn(async (markdown: string) => ({
            tokens: Math.max(1, Math.ceil(markdown.length / 12)),
            method: "estimate" as const,
        })),
        buildContextPack: vi.fn(async (options: Record<string, unknown>, outputPath: string) => {
            testState.buildContextPackCalls.push({ options, outputPath });
            await writeFile(outputPath, "# Mock Pro Context Pack\n\nPacked context.\n", "utf8");
            return {
                packPath: outputPath,
                projectDir: String(options.projectDir ?? process.cwd()),
                seedFiles: [{ path: "src/mock.ts", content: "export const mock = true;\n", tokens: 12 }],
                relatedFiles: [],
                omittedFiles: [],
                diffText: String(options.diffRef ?? "") ? "diff --git a/src/mock.ts b/src/mock.ts" : undefined,
                diffRef: options.diffRef as string | undefined,
                warnings: [],
                tokenCount: {
                    tokens: 42,
                    method: "estimate" as const,
                },
            };
        }),
    };
});

vi.mock("./artifacts.js", async () => {
    const { mkdir, writeFile } = await import("node:fs/promises");
    const path = await import("node:path");

    return {
        createArtifactDir: vi.fn(async () => {
            testState.artifactCounter += 1;
            const dir = path.join(testState.tempRoot, `run-${String(testState.artifactCounter).padStart(3, "0")}`);
            await mkdir(dir, { recursive: true });
            return dir;
        }),
        artifactPaths: vi.fn((artifactDir: string, passNumber: number, hasPack: boolean) => {
            const artifactPrefix = `pass-${String(passNumber).padStart(3, "0")}-mock`;
            return {
                artifactPrefix,
                requestPath: path.join(artifactDir, `${artifactPrefix}.request.md`),
                responsePath: path.join(artifactDir, `${artifactPrefix}.response.md`),
                submitPath: path.join(artifactDir, `${artifactPrefix}.submit.md`),
                metaPath: path.join(artifactDir, `${artifactPrefix}.meta.json`),
                packPath: hasPack ? path.join(artifactDir, `${artifactPrefix}.pack.md`) : undefined,
            };
        }),
        writeJson: vi.fn(async (targetPath: string, value: unknown) => {
            await writeFile(targetPath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
        }),
        writeStateFile: vi.fn(async (artifactDir: string, state: unknown) => {
            await writeFile(path.join(artifactDir, "state.json"), `${JSON.stringify(state, null, 4)}\n`, "utf8");
        }),
    };
});

import { defaultState, handleCommand, restoreStateFromEntries } from "./workflow.js";

type FakeEntry = {
    type: string;
    id: string;
    parentId: string | null;
    timestamp: string;
    customType?: string;
    data?: unknown;
    content?: unknown;
    display?: boolean;
    message?: {
        role?: string;
        content?: unknown;
    };
};

class FakeSessionManager {
    entries: FakeEntry[] = [];
    leafId: string | null = null;
    labels = new Map<string, string>();
    nextId = 1;

    appendUserMessage(text: string): string {
        return this.appendEntry({
            type: "message",
            message: {
                role: "user",
                content: [{ type: "text", text }],
            },
        });
    }

    appendAssistantMessage(text: string): string {
        return this.appendEntry({
            type: "message",
            message: {
                role: "assistant",
                content: [{ type: "text", text }],
            },
        });
    }

    appendCustomEntry(customType: string, data: unknown): string {
        return this.appendEntry({
            type: "custom",
            customType,
            data: structuredClone(data),
        });
    }

    appendCustomMessage(customType: string, content: unknown, display: boolean): string {
        return this.appendEntry({
            type: "custom_message",
            customType,
            content: structuredClone(content),
            display,
        });
    }

    appendEntry(entry: Omit<FakeEntry, "id" | "parentId" | "timestamp">): string {
        const id = `entry-${String(this.nextId).padStart(4, "0")}`;
        this.nextId += 1;
        this.entries.push({
            ...entry,
            id,
            parentId: this.leafId,
            timestamp: new Date().toISOString(),
        });
        this.leafId = id;
        return id;
    }

    getEntries(): FakeEntry[] {
        return [...this.entries];
    }

    getEntry(id: string): FakeEntry | undefined {
        return this.entries.find((entry) => entry.id === id);
    }

    getLeafId(): string | null {
        return this.leafId;
    }

    getBranch(fromId?: string): FakeEntry[] {
        const startId = fromId ?? this.leafId;
        if (!startId) {
            return [];
        }

        const branch: FakeEntry[] = [];
        let currentId: string | null = startId;
        while (currentId) {
            const entry = this.getEntry(currentId);
            if (!entry) {
                break;
            }
            branch.push(entry);
            currentId = entry.parentId;
        }
        return branch.reverse();
    }

    branch(branchFromId: string): void {
        this.leafId = branchFromId;
    }
}

function createHarness() {
    const sessionManager = new FakeSessionManager();
    const notifications: Array<{ message: string; level: string }> = [];
    const statusUpdates: Array<{ key: string; value: unknown }> = [];
    const workingMessages: Array<string | undefined> = [];
    const sentMessages: Array<{ customType: string; content: unknown; display: boolean }> = [];
    const navigations: Array<{ targetId: string; options: Record<string, unknown> }> = [];
    let editorText = "";

    const ui = {
        theme: {
            fg: (_color: string, text: string) => text,
        },
        notify(message: string, level: string) {
            notifications.push({ message, level });
        },
        setStatus(key: string, value: unknown) {
            statusUpdates.push({ key, value });
        },
        setWorkingMessage(message?: string) {
            workingMessages.push(message);
        },
        setEditorText(value: string) {
            editorText = value;
        },
    };

    const pi = {
        appendEntry(customType: string, data: unknown) {
            return sessionManager.appendCustomEntry(customType, data);
        },
        setLabel(targetId: string, label: string) {
            sessionManager.labels.set(targetId, label);
        },
        sendMessage(message: { customType: string; content: unknown; display: boolean }) {
            sentMessages.push(message);
            sessionManager.appendCustomMessage(message.customType, message.content, message.display);
        },
    } as const;

    const ctx = {
        sessionManager,
        ui,
        async navigateTree(targetId: string, options: Record<string, unknown>) {
            sessionManager.branch(targetId);
            navigations.push({ targetId, options });
            return { cancelled: false };
        },
    } as const;

    return {
        ctx,
        editorText: () => editorText,
        navigations,
        notifications,
        pi,
        sentMessages,
        sessionManager,
        statusUpdates,
        workingMessages,
    };
}

beforeEach(async () => {
    testState.tempRoot = await mkdtemp(path.join(os.tmpdir(), "pro-workflow-"));
    testState.artifactCounter = 0;
    testState.clipboardText = "";
    testState.copyShouldFail = false;
    testState.revealShouldFail = false;
    testState.buildContextPackCalls = [];
    vi.clearAllMocks();
});

describe("workflow", () => {
    it("runs start -> pass -> import -> return across the active /pro side-thread", async () => {
        const harness = createHarness();
        const state = defaultState();

        harness.sessionManager.appendUserMessage("review the extension");
        harness.sessionManager.appendAssistantMessage("okay");

        await handleCommand(harness.pi as never, state, harness.ctx as never, "start");

        expect(state.active).toBe(true);
        expect(state.anchorEntryId).toBeTruthy();
        expect(harness.sentMessages.at(-1)?.customType).toBe("pro-status");

        await handleCommand(
            harness.pi as never,
            state,
            harness.ctx as never,
            'pass "review the architecture" --intent review --transcript none --path extensions/pro --changed HEAD --diff HEAD',
        );

        expect(state.pendingPass?.passNumber).toBe(1);
        expect(state.pendingPass?.handoff.clipboard.detail).toBe("copied");
        expect(harness.sentMessages.at(-1)?.customType).toBe("pro-status");
        expect(String(harness.sentMessages.at(-1)?.content)).toContain("Clipboard: copied");
        expect(String(harness.sentMessages.at(-1)?.content)).toContain("Reveal:");
        expect(testState.buildContextPackCalls).toHaveLength(1);
        expect(testState.buildContextPackCalls[0]?.options.pathSpecs).toEqual(["extensions/pro"]);
        expect(testState.buildContextPackCalls[0]?.options.changedRef).toBe("HEAD");
        expect(testState.buildContextPackCalls[0]?.options.diffRef).toBe("HEAD");

        testState.clipboardText = "Imported Pro response";
        await handleCommand(harness.pi as never, state, harness.ctx as never, "import");

        expect(state.passCount).toBe(1);
        expect(state.pendingPass).toBeUndefined();
        expect(state.latestResponsePath).toBeTruthy();
        expect(await readFile(state.latestResponsePath!, "utf8")).toContain("Imported Pro response");
        expect(harness.sentMessages.at(-1)?.customType).toBe("pro-response");

        await handleCommand(harness.pi as never, state, harness.ctx as never, "return");

        expect(state.active).toBe(false);
        expect(harness.navigations).toHaveLength(1);
        expect(harness.navigations[0]?.targetId).toBe(state.anchorEntryId);
        expect(harness.editorText()).toContain("<pro-takeaway>");
        expect(harness.editorText()).toContain("Imported Pro response");
    });

    it("refuses pass and import when the user has left the active /pro side-thread", async () => {
        const harness = createHarness();
        const state = defaultState();

        const rootId = harness.sessionManager.appendUserMessage("start here");
        harness.sessionManager.appendAssistantMessage("sounds good");

        await handleCommand(harness.pi as never, state, harness.ctx as never, "start");

        harness.sessionManager.branch(rootId);
        await handleCommand(harness.pi as never, state, harness.ctx as never, 'pass "should fail" --transcript none');
        expect(harness.sentMessages.at(-1)?.customType).toBe("pro-error");
        expect(String(harness.sentMessages.at(-1)?.content)).toContain("not on the active /pro side-thread");

        harness.sessionManager.branch(state.anchorEntryId!);
        await handleCommand(harness.pi as never, state, harness.ctx as never, 'pass "review this" --transcript none');
        expect(state.pendingPass).toBeTruthy();

        harness.sessionManager.branch(rootId);
        testState.clipboardText = "Should not import";
        await handleCommand(harness.pi as never, state, harness.ctx as never, "import");
        expect(harness.sentMessages.at(-1)?.customType).toBe("pro-error");
        expect(String(harness.sentMessages.at(-1)?.content)).toContain("not on the active /pro side-thread");
        expect(state.pendingPass).toBeTruthy();
    });

    it("reports explicit manual-handoff results and renders /pro status as a message", async () => {
        const harness = createHarness();
        const state = defaultState();

        harness.sessionManager.appendUserMessage("status check");
        await handleCommand(harness.pi as never, state, harness.ctx as never, "start");

        testState.copyShouldFail = true;
        testState.revealShouldFail = process.platform === "darwin";

        await handleCommand(harness.pi as never, state, harness.ctx as never, 'pass "review this" --transcript none');

        const preparedMessage = harness.sentMessages.at(-1);
        expect(preparedMessage?.customType).toBe("pro-status");
        expect(String(preparedMessage?.content)).toContain("Clipboard: failed — copy nope");
        expect(String(preparedMessage?.content)).toContain("Reveal:");

        await handleCommand(harness.pi as never, state, harness.ctx as never, 'pass "try again" --transcript none');
        const blockedMessage = harness.sentMessages.at(-1);
        expect(blockedMessage?.customType).toBe("pro-error");
        expect(String(blockedMessage?.content)).toContain("already waiting for /pro import");

        await handleCommand(harness.pi as never, state, harness.ctx as never, "status");

        const statusMessage = harness.sentMessages.at(-1);
        expect(statusMessage?.customType).toBe("pro-status");
        expect(String(statusMessage?.content)).toContain("# /pro status");
        expect(String(statusMessage?.content)).toContain("## Pending import");
        expect(String(statusMessage?.content)).toContain("Clipboard: failed — copy nope");
    });

    it("restores pending-pass handoff status for older persisted state entries", () => {
        const restored = restoreStateFromEntries([
            {
                type: "custom",
                id: "entry-0001",
                parentId: null,
                timestamp: new Date().toISOString(),
                customType: "pro-state",
                data: {
                    active: true,
                    anchorEntryId: "entry-0009",
                    artifactDir: "/tmp/pro-run",
                    passCount: 0,
                    pendingPass: {
                        passNumber: 1,
                        artifactPrefix: "pass-001-mock",
                        prompt: "review this",
                        intent: "review",
                        transcriptScope: "origin",
                        contextSelection: {
                            transcript: "origin",
                            sources: [],
                            expansion: {
                                dependents: true,
                                docs: false,
                                tests: false,
                            },
                            budget: 280000,
                        },
                        requestPath: "/tmp/pro-run/pass-001-mock.request.md",
                        responsePath: "/tmp/pro-run/pass-001-mock.response.md",
                        metaPath: "/tmp/pro-run/pass-001-mock.meta.json",
                        submitPath: "/tmp/pro-run/pass-001-mock.submit.md",
                        preparedAt: Date.now(),
                    },
                },
            },
        ] as never);

        expect(restored.pendingPass?.handoff.clipboard.state).toBe("skipped");
        expect(restored.pendingPass?.handoff.reveal.state).toBe("skipped");
    });
});
