import { describe, expect, it } from "vitest";
import { parseCommand } from "./args.js";

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
        const parsed = parseCommand("", "/tmp/project", {
            active: true,
            passCount: 1,
            defaults: {
                projectDir: "/tmp/project",
                pathSpecs: [],
                budget: 280000,
                includeDependents: true,
                includeDocs: false,
                includeTests: false,
            },
        });
        expect("error" in parsed).toBe(false);
        if ("error" in parsed) {
            return;
        }
        expect(parsed.subcommand).toBe("status");
    });

    it("parses pass with explicit code options", () => {
        const parsed = parseCommand(
            'pass --path src/foo.ts --path docs --budget 300000 --include-docs "tighten the plan"',
            "/tmp/project",
        );

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.subcommand).toBe("pass");
        expect(parsed.options.pathSpecs).toEqual(["src/foo.ts", "docs"]);
        expect(parsed.options.budget).toBe(300000);
        expect(parsed.options.includeDocs).toBe(true);
        expect(parsed.options.prompt).toBe("tighten the plan");
    });

    it("makes explicit --path override inherited defaults", () => {
        const parsed = parseCommand('pass --path src/new-area "tighten the plan"', "/tmp/project", {
            active: true,
            passCount: 1,
            defaults: {
                projectDir: "/tmp/project",
                pathSpecs: ["src/old-area", "docs"],
                budget: 280000,
                includeDependents: true,
                includeDocs: false,
                includeTests: false,
            },
        });

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.pathSpecs).toEqual(["src/new-area"]);
    });

    it("treats no-code as overriding stored paths", () => {
        const parsed = parseCommand("pass --no-code", "/tmp/project", {
            active: true,
            passCount: 1,
            defaults: {
                projectDir: "/tmp/project",
                pathSpecs: ["src"],
                budget: 280000,
                includeDependents: true,
                includeDocs: false,
                includeTests: false,
            },
        });

        expect("error" in parsed).toBe(false);
        if ("error" in parsed || !parsed.options) {
            return;
        }

        expect(parsed.options.noCode).toBe(true);
        expect(parsed.options.pathSpecs).toEqual([]);
    });

    it("rejects unknown options instead of treating them as prompt text", () => {
        const parsed = parseCommand("pass --budegt 300000 tighten things", "/tmp/project");
        expect("error" in parsed).toBe(true);
        if ("error" in parsed) {
            expect(parsed.error).toContain("Unknown option: --budegt");
        }
    });
});
