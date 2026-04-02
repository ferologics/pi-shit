import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactPaths, artifactPrefixFromPath } from "./artifacts.js";

describe("artifactPaths", () => {
    it("uses one shared artifact prefix for all files in a pass family", () => {
        const paths = artifactPaths("/tmp/pro", 3, true);

        expect(paths.artifactPrefix).toMatch(/^pass-003-\d{8}-\d{6}-\d{3}$/);
        expect(paths.requestPath).toBe(path.join("/tmp/pro", `${paths.artifactPrefix}.request.md`));
        expect(paths.packPath).toBe(path.join("/tmp/pro", `${paths.artifactPrefix}.pack.md`));
        expect(paths.submitPath).toBe(path.join("/tmp/pro", `${paths.artifactPrefix}.submit.md`));
        expect(paths.responsePath).toBe(path.join("/tmp/pro", `${paths.artifactPrefix}.response.md`));
        expect(paths.metaPath).toBe(path.join("/tmp/pro", `${paths.artifactPrefix}.meta.json`));
    });

    it("omits packPath for transcript-only passes", () => {
        const paths = artifactPaths("/tmp/pro", 1, false);

        expect(paths.artifactPrefix).toMatch(/^pass-001-\d{8}-\d{6}-\d{3}$/);
        expect(paths.packPath).toBeUndefined();
    });

    it("can recover the artifact prefix from any artifact file path", () => {
        expect(artifactPrefixFromPath("/tmp/pro/pass-001-20260330-171612-417.request.md")).toBe(
            "pass-001-20260330-171612-417",
        );
        expect(artifactPrefixFromPath("/tmp/pro/pass-001-20260330-171612-417.submit.md")).toBe(
            "pass-001-20260330-171612-417",
        );
        expect(artifactPrefixFromPath("/tmp/pro/pass-001-20260330-171612-417.meta.json")).toBe(
            "pass-001-20260330-171612-417",
        );
    });
});
