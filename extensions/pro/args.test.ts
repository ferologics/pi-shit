import { describe, expect, it } from "vitest";
import { parseCommand } from "./args.js";

const ACTIVE_STATE = {
    active: true,
    passCount: 1,
    defaults: {
        projectDir: "/tmp/project",
        budget: 280000,
        includeDependents: true,
        includeDocs: false,
        includeTests: false,
    },
    lastSelection: {
        transcript: "last-import" as const,
        sources: [
            { kind: "paths" as const, specs: ["src/old-area", "docs"] },
            { kind: "changed" as const, ref: "origin/main" },
            { kind: "diff" as const, ref: "HEAD" },
        ],
        expansion: {
            dependents: false,
            docs: true,
            tests: false,
        },
        budget: 190000,
    },
};

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
        const parsed = parseCommand("", "/tmp/project", ACTIVE_STATE);
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("status");
    });

    it("parses pass with explicit options", () => {
        const parsed = parseCommand(
            'pass --intent review --transcript none --changed origin/main --diff --path src/foo.ts --path docs --budget 300000 --include-docs "tighten the bundle"',
            "/tmp/project",
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.subcommand).toBe("pass");
        expect(parsed.options.intent).toBe("review");
        expect(parsed.options.transcriptScope).toBe("none");
        expect(parsed.options.pathSpecs).toEqual(["src/foo.ts", "docs"]);
        expect(parsed.options.changedRef).toBe("origin/main");
        expect(parsed.options.diffRef).toBe("HEAD");
        expect(parsed.options.budget).toBe(300000);
        expect(parsed.options.includeDocs).toBe(true);
        expect(parsed.options.prompt).toBe("tighten the bundle");
        expect(parsed.options.reuseContext).toBe(false);
    });

    it("does not silently inherit stored paths or transcript scope", () => {
        const parsed = parseCommand('pass "tighten the bundle"', "/tmp/project", ACTIVE_STATE);

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.pathSpecs).toEqual([]);
        expect(parsed.options.changedRef).toBeUndefined();
        expect(parsed.options.diffRef).toBeUndefined();
        expect(parsed.options.transcriptScope).toBe("origin");
        expect(parsed.options.intent).toBe("general");
    });

    it("reuses the last context selection only with --reuse-context", () => {
        const parsed = parseCommand('pass --reuse-context "tighten the bundle"', "/tmp/project", ACTIVE_STATE);

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.reuseContext).toBe(true);
        expect(parsed.options.pathSpecs).toEqual(["src/old-area", "docs"]);
        expect(parsed.options.changedRef).toBe("origin/main");
        expect(parsed.options.diffRef).toBe("HEAD");
        expect(parsed.options.transcriptScope).toBe("last-import");
        expect(parsed.options.includeDependents).toBe(false);
        expect(parsed.options.includeDocs).toBe(true);
        expect(parsed.options.budget).toBe(190000);
    });

    it("makes explicit --path override reused defaults", () => {
        const parsed = parseCommand(
            'pass --reuse-context --path src/new-area "tighten the bundle"',
            "/tmp/project",
            ACTIVE_STATE,
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.pathSpecs).toEqual(["src/new-area"]);
        expect(parsed.options.changedRef).toBe("origin/main");
        expect(parsed.options.diffRef).toBe("HEAD");
    });

    it("keeps explicit --path even if --reuse-context appears later", () => {
        const parsed = parseCommand(
            'pass --path src/new-area --reuse-context "tighten the bundle"',
            "/tmp/project",
            ACTIVE_STATE,
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.pathSpecs).toEqual(["src/new-area"]);
        expect(parsed.options.transcriptScope).toBe("last-import");
    });

    it("lets explicit transcript override reused context", () => {
        const parsed = parseCommand(
            'pass --reuse-context --transcript origin "tighten the bundle"',
            "/tmp/project",
            ACTIVE_STATE,
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.transcriptScope).toBe("origin");
    });

    it("preserves explicit changed and diff refs even if --reuse-context appears later", () => {
        const parsed = parseCommand(
            'pass --changed HEAD~1 --diff origin/dev --reuse-context "tighten the bundle"',
            "/tmp/project",
            ACTIVE_STATE,
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.changedRef).toBe("HEAD~1");
        expect(parsed.options.diffRef).toBe("origin/dev");
    });

    it("treats no-code as overriding reused paths", () => {
        const parsed = parseCommand("pass --reuse-context --no-code", "/tmp/project", ACTIVE_STATE);

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.noCode).toBe(true);
        expect(parsed.options.pathSpecs).toEqual([]);
        expect(parsed.options.changedRef).toBeUndefined();
        expect(parsed.options.diffRef).toBeUndefined();
    });

    it("parses return", () => {
        const parsed = parseCommand("return", "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("return");
    });

    it("parses import without args as clipboard import", () => {
        const parsed = parseCommand("import", "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("import");
        expect(parsed.inputPath).toBeUndefined();
    });

    it("parses import with an explicit file path", () => {
        const parsed = parseCommand('import "responses/final.md"', "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("import");
        expect(parsed.inputPath).toBe("/tmp/project/responses/final.md");
    });

    it("uses HEAD when --changed has no explicit ref", () => {
        const parsed = parseCommand("pass --changed", "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }
        expect(parsed.options.changedRef).toBe("HEAD");
    });

    it("uses HEAD when --diff has no explicit ref", () => {
        const parsed = parseCommand("pass --diff", "/tmp/project");
        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }
        expect(parsed.options.diffRef).toBe("HEAD");
    });

    it("rejects invalid intent values", () => {
        const parsed = parseCommand("pass --intent weird", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Invalid intent");
        }
    });

    it("rejects invalid transcript scope values", () => {
        const parsed = parseCommand("pass --transcript weird", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Invalid transcript scope");
        }
    });

    it("rejects import flags", () => {
        const parsed = parseCommand("import --clipboard", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Unknown option: --clipboard");
        }
    });

    it("rejects unknown subcommands instead of accepting deprecated aliases", () => {
        const parsed = parseCommand("final", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Unknown subcommand: final");
        }
    });

    it("rejects unknown options instead of treating them as prompt text", () => {
        const parsed = parseCommand("pass --budegt 300000 tighten things", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Unknown option: --budegt");
        }
    });
});
