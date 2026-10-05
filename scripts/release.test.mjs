import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const releaseScript = fileURLToPath(new URL("./release.mjs", import.meta.url));

function createFixture(t) {
    const cwd = mkdtempSync(path.join(os.tmpdir(), "pi-release-test-"));
    t.after(() => rmSync(cwd, { recursive: true, force: true }));

    function write(relativePath, content) {
        const absolutePath = path.join(cwd, relativePath);
        mkdirSync(path.dirname(absolutePath), { recursive: true });
        writeFileSync(absolutePath, content);
    }

    for (const [directory, name, version] of [
        [".", "pi-shit", "0.9.0"],
        ["extensions", "@ferologics/pi-extensions", "0.7.0"],
        ["skills", "@ferologics/pi-skills", "1.2.0"],
        ["extensions/deep-review", "pi-deep-review", "0.2.0"],
    ]) {
        write(path.join(directory, "package.json"), JSON.stringify({
            name,
            version,
            piRelease: {
                repo: `example/${name.split("/").at(-1)}`,
                branch: "main",
                ...(directory === "." ? {} : { subtreePublishRecipe: `publish-${directory.replaceAll("/", "-")}` }),
            },
        }));
        write(path.join(directory, ".github/workflows/npm-publish.yml"), "# Fixture workflow\n");
    }

    const lockfile = {
        name: "@ferologics/pi-extensions",
        version: "0.7.0",
        lockfileVersion: 3,
        packages: {
            "": { name: "@ferologics/pi-extensions", version: "0.7.0" },
            "node_modules/test-dependency": { version: "1.2.3", integrity: "fixture-integrity" },
        },
    };
    write("extensions/package-lock.json", JSON.stringify(lockfile));

    // Exercise release orchestration without touching real git remotes or GitHub releases.
    for (const command of ["git", "gh", "just"]) {
        write(`bin/${command}`, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$RELEASE_TEST_COMMANDS"\nif [ "$1 $2" = "release view" ]; then exit 1; fi\n');
        chmodSync(path.join(cwd, "bin", command), 0o755);
    }

    return {
        cwd,
        lockfile,
        read: (relativePath) => JSON.parse(readFileSync(path.join(cwd, relativePath), "utf8")),
        run: (...extraArgs) => execFileSync(process.execPath, [
            releaseScript, "--target", "pi-deep-review", "--bump", "minor", ...extraArgs,
        ], {
            cwd,
            encoding: "utf8",
            env: {
                ...process.env,
                PATH: `${path.join(cwd, "bin")}${path.delimiter}${process.env.PATH}`,
                RELEASE_TEST_COMMANDS: path.join(cwd, "commands.log"),
            },
        }),
    };
}

test("release commits lockfile versions with the propagated package versions", (t) => {
    const fixture = createFixture(t);
    fixture.run();

    assert.equal(fixture.read("extensions/deep-review/package.json").version, "0.3.0");
    assert.equal(fixture.read("extensions/package.json").version, "0.8.0");
    assert.equal(fixture.read("package.json").version, "0.10.0");
    assert.equal(fixture.read("skills/package.json").version, "1.2.0");
    const lockfile = fixture.read("extensions/package-lock.json");
    assert.equal(lockfile.version, "0.8.0");
    assert.equal(lockfile.packages[""].version, "0.8.0");
    assert.deepEqual(lockfile.packages["node_modules/test-dependency"], fixture.lockfile.packages["node_modules/test-dependency"]);
    const commands = readFileSync(path.join(fixture.cwd, "commands.log"), "utf8");
    assert.match(commands, /^add .*extensions\/package-lock\.json/m);
    assert.match(commands, /^publish-extensions-deep-review$/m);
    assert.match(commands, /^publish-extensions$/m);
    assert.equal(commands.match(/^release create /gm)?.length, 3);
});

test("dry-run includes the lockfile in the plan without changing files or running commands", (t) => {
    const fixture = createFixture(t);
    const output = fixture.run("--dry-run");

    assert.match(output, /git add .*extensions\/package-lock\.json/);
    assert.deepEqual(fixture.read("extensions/package-lock.json"), fixture.lockfile);
    assert.equal(fixture.read("extensions/deep-review/package.json").version, "0.2.0");
    assert.equal(fixture.read("extensions/package.json").version, "0.7.0");
    assert.equal(fixture.read("package.json").version, "0.9.0");
    assert.throws(() => readFileSync(path.join(fixture.cwd, "commands.log")), { code: "ENOENT" });
});
