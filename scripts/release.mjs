import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();

const PACKAGE_DEFINITIONS = {
    "pi-shit": {
        manifestPath: "package.json",
        repo: "ferologics/pi-shit",
        branch: "main",
        subtreePublishRecipe: null,
        npmPublishCwd: ".",
    },
    "pi-extensions": {
        manifestPath: "extensions/package.json",
        repo: "ferologics/pi-extensions",
        branch: "main",
        subtreePublishRecipe: "publish-extensions",
        npmPublishCwd: "extensions",
    },
    "pi-deep-review": {
        manifestPath: "extensions/deep-review/package.json",
        repo: "ferologics/pi-deep-review",
        branch: "main",
        subtreePublishRecipe: "publish-pi-deep-review",
        npmPublishCwd: "extensions/deep-review",
    },
    "pi-notify": {
        manifestPath: "extensions/pi-notify/package.json",
        repo: "ferologics/pi-notify",
        branch: "master",
        subtreePublishRecipe: "publish-pi-notify",
        npmPublishCwd: "extensions/pi-notify",
    },
    "pi-system-theme": {
        manifestPath: "extensions/pi-system-theme/package.json",
        repo: "ferologics/pi-system-theme",
        branch: "main",
        subtreePublishRecipe: "publish-pi-system-theme",
        npmPublishCwd: "extensions/pi-system-theme",
    },
};

const TARGET_PLANS = {
    "pi-shit": ["pi-shit"],
    "pi-extensions": ["pi-extensions", "pi-shit"],
    extensions: ["pi-extensions", "pi-shit"],
    "pi-deep-review": ["pi-deep-review", "pi-extensions", "pi-shit"],
    "deep-review": ["pi-deep-review", "pi-extensions", "pi-shit"],
    "pi-notify": ["pi-notify", "pi-extensions", "pi-shit"],
    notify: ["pi-notify", "pi-extensions", "pi-shit"],
    "pi-system-theme": ["pi-system-theme", "pi-extensions", "pi-shit"],
    "system-theme": ["pi-system-theme", "pi-extensions", "pi-shit"],
};

const ALLOWED_BUMPS = new Set(["patch", "minor", "major"]);

function quoteArg(value) {
    if (/^[A-Za-z0-9_./:-]+$/.test(value)) {
        return value;
    }

    return JSON.stringify(value);
}

function run(command, args, options = {}) {
    const cwd = options.cwd ? path.join(ROOT, options.cwd) : ROOT;
    const capture = options.capture ?? false;
    const allowFailure = options.allowFailure ?? false;
    const dryRun = options.dryRun ?? false;

    const display = [command, ...args.map(quoteArg)].join(" ");
    const location = cwd === ROOT ? "" : `  (cwd: ${path.relative(ROOT, cwd) || "."})`;
    console.log(`$ ${display}${location}`);

    if (dryRun) {
        return {
            status: 0,
            stdout: "",
            stderr: "",
        };
    }

    const result = spawnSync(command, args, {
        cwd,
        stdio: capture ? "pipe" : "inherit",
        encoding: "utf8",
    });

    if (result.error) {
        throw result.error;
    }

    if ((result.status ?? 1) !== 0 && !allowFailure) {
        const stderr = result.stderr?.trim();
        const stdout = result.stdout?.trim();
        const output = stderr || stdout;
        throw new Error(output ? `${command} failed: ${output}` : `${command} failed with exit code ${result.status}`);
    }

    return result;
}

function parseArgs(argv) {
    const options = {
        target: undefined,
        bump: "patch",
        dryRun: false,
    };

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index];

        if (token === "--target") {
            options.target = argv[index + 1];
            index += 1;
            continue;
        }

        if (token === "--bump") {
            options.bump = argv[index + 1] ?? "patch";
            index += 1;
            continue;
        }

        if (token === "--dry-run") {
            options.dryRun = true;
            continue;
        }

        throw new Error(`Unknown argument: ${token}`);
    }

    if (!options.target) {
        throw new Error("Missing required argument: --target");
    }

    if (options.target.startsWith("target=")) {
        options.target = options.target.slice("target=".length);
    }

    if (options.bump.startsWith("bump=")) {
        options.bump = options.bump.slice("bump=".length);
    }

    if (!ALLOWED_BUMPS.has(options.bump)) {
        throw new Error(`Invalid --bump value: ${options.bump}. Use patch|minor|major.`);
    }

    return options;
}

function parseSemver(version) {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (!match) {
        throw new Error(`Unsupported version format: ${version}. Expected x.y.z`);
    }

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

function bumpSemver(version, bump) {
    const current = parseSemver(version);

    if (bump === "major") {
        return `${current.major + 1}.0.0`;
    }

    if (bump === "minor") {
        return `${current.major}.${current.minor + 1}.0`;
    }

    return `${current.major}.${current.minor}.${current.patch + 1}`;
}

function readManifest(relativePath) {
    const absolutePath = path.join(ROOT, relativePath);
    const text = fs.readFileSync(absolutePath, "utf8");
    return JSON.parse(text);
}

function writeManifest(relativePath, value) {
    const absolutePath = path.join(ROOT, relativePath);
    const text = `${JSON.stringify(value, null, 4)}\n`;
    fs.writeFileSync(absolutePath, text, "utf8");
}

function ensureCleanWorkingTree(dryRun) {
    const status = run("git", ["status", "--porcelain"], {
        capture: true,
        dryRun,
    });

    if (!dryRun && status.stdout.trim().length > 0) {
        throw new Error("Working tree must be clean before release.");
    }
}

function npmVersionExists(name, version, dryRun) {
    const result = run("npm", ["view", `${name}@${version}`, "version"], {
        capture: true,
        allowFailure: true,
        dryRun,
    });

    if (dryRun) {
        return false;
    }

    return (result.status ?? 1) === 0;
}

function ghReleaseExists(repo, tag, dryRun) {
    const result = run("gh", ["release", "view", tag, "--repo", repo], {
        capture: true,
        allowFailure: true,
        dryRun,
    });

    if (dryRun) {
        return false;
    }

    return (result.status ?? 1) === 0;
}

function unique(values) {
    return [...new Set(values)];
}

function planForTarget(target, bump) {
    const packageIds = TARGET_PLANS[target];
    if (!packageIds) {
        throw new Error(`Unknown target: ${target}`);
    }

    return packageIds.map((packageId) => {
        const definition = PACKAGE_DEFINITIONS[packageId];
        if (!definition) {
            throw new Error(`Missing package definition for target package: ${packageId}`);
        }

        const manifest = readManifest(definition.manifestPath);

        if (manifest.name !== packageId) {
            throw new Error(
                `${definition.manifestPath} expected name=${packageId} but found ${manifest.name ?? "<missing>"}`,
            );
        }

        if (typeof manifest.version !== "string") {
            throw new Error(`${definition.manifestPath} is missing a string version field`);
        }

        const nextVersion = bumpSemver(manifest.version, bump);

        return {
            packageId,
            definition,
            manifest,
            from: manifest.version,
            to: nextVersion,
        };
    });
}

function printPlan(target, bump, plan, dryRun) {
    console.log("");
    console.log(`Release target: ${target}`);
    console.log(`Bump: ${bump}`);
    console.log(`Mode: ${dryRun ? "dry-run" : "execute"}`);
    console.log("");
    console.log("Version plan:");

    for (const item of plan) {
        console.log(`- ${item.packageId}: ${item.from} -> ${item.to}`);
    }

    console.log("");
}

function commitMessage(target, bump, plan) {
    const summary = plan.map((item) => `${item.packageId}@${item.to}`).join(", ");
    return `release: ${target} ${bump} (${summary})`;
}

function executeRelease(options, plan) {
    ensureCleanWorkingTree(options.dryRun);

    const changedManifestPaths = [];

    for (const item of plan) {
        changedManifestPaths.push(item.definition.manifestPath);

        if (!options.dryRun) {
            item.manifest.version = item.to;
            writeManifest(item.definition.manifestPath, item.manifest);
        }
    }

    run("git", ["add", ...changedManifestPaths], { dryRun: options.dryRun });
    run("git", ["commit", "-m", commitMessage(options.target, options.bump, plan)], { dryRun: options.dryRun });
    run("git", ["push", "origin", "main"], { dryRun: options.dryRun });

    const subtreePublishRecipes = unique(
        plan
            .map((item) => item.definition.subtreePublishRecipe)
            .filter((value) => typeof value === "string" && value.length > 0),
    );

    for (const recipe of subtreePublishRecipes) {
        run("just", [recipe], { dryRun: options.dryRun });
    }

    for (const item of plan) {
        if (npmVersionExists(item.packageId, item.to, options.dryRun)) {
            console.log(`- npm publish skipped for ${item.packageId}@${item.to} (already exists)`);
            continue;
        }

        run("npm", ["publish"], {
            cwd: item.definition.npmPublishCwd,
            dryRun: options.dryRun,
        });
    }

    for (const item of plan) {
        const tag = `v${item.to}`;

        if (ghReleaseExists(item.definition.repo, tag, options.dryRun)) {
            console.log(`- GitHub release skipped for ${item.definition.repo} ${tag} (already exists)`);
            continue;
        }

        run(
            "gh",
            [
                "release",
                "create",
                tag,
                "--repo",
                item.definition.repo,
                "--target",
                item.definition.branch,
                "--title",
                `${item.packageId} ${tag}`,
                "--generate-notes",
            ],
            { dryRun: options.dryRun },
        );
    }

    console.log("");
    console.log("Release flow complete.");
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const plan = planForTarget(options.target, options.bump);

    printPlan(options.target, options.bump, plan, options.dryRun);
    executeRelease(options, plan);
}

main();
