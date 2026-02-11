import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const ROOT = process.cwd();
const ALLOWED_BUMPS = new Set(["patch", "minor", "major"]);
const ROOT_RELEASE_MANIFESTS = ["package.json", "extensions/package.json"];
const EXTENSIONS_DIR = "extensions";

function normalizePath(value) {
    return value.split(path.sep).join("/");
}

function quoteArg(value) {
    if (/^[A-Za-z0-9_./:@-]+$/.test(value)) {
        return value;
    }

    return JSON.stringify(value);
}

function unique(values) {
    return [...new Set(values)];
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
        validate: false,
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

        if (token === "--validate") {
            options.validate = true;
            continue;
        }

        throw new Error(`Unknown argument: ${token}`);
    }

    if (!ALLOWED_BUMPS.has(options.bump)) {
        throw new Error(`Invalid --bump value: ${options.bump}. Use patch|minor|major.`);
    }

    if (options.validate && options.target) {
        throw new Error("--validate cannot be combined with --target");
    }

    if (!options.validate && !options.target) {
        throw new Error("Missing required argument: --target");
    }

    return options;
}

function assertManifestExists(manifestPath) {
    const absolutePath = path.join(ROOT, manifestPath);
    if (!fs.existsSync(absolutePath)) {
        throw new Error(`Missing release manifest: ${manifestPath}`);
    }
}

function collectReleaseManifestPaths() {
    const manifests = [];

    for (const manifestPath of ROOT_RELEASE_MANIFESTS) {
        const normalized = normalizePath(manifestPath);
        assertManifestExists(normalized);
        manifests.push(normalized);
    }

    const extensionsPath = path.join(ROOT, EXTENSIONS_DIR);
    const entries = fs.readdirSync(extensionsPath, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const manifestPath = normalizePath(path.join(EXTENSIONS_DIR, entry.name, "package.json"));
        if (fs.existsSync(path.join(ROOT, manifestPath))) {
            manifests.push(manifestPath);
        }
    }

    return unique(manifests);
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

function parseRepoSlug(value) {
    if (typeof value !== "string") {
        return null;
    }

    const normalized = value.trim();
    if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(normalized)) {
        return normalized;
    }

    return null;
}

function readPiReleaseConfig(manifestPath, manifest) {
    const releaseConfig = manifest.piRelease;

    if (!releaseConfig || typeof releaseConfig !== "object" || Array.isArray(releaseConfig)) {
        throw new Error(`${manifestPath} must define piRelease object`);
    }

    if (typeof releaseConfig.branch !== "string" || releaseConfig.branch.trim().length === 0) {
        throw new Error(`${manifestPath} piRelease.branch must be a non-empty string`);
    }

    const repo = parseRepoSlug(releaseConfig.repo);
    if (!repo) {
        throw new Error(`${manifestPath} piRelease.repo must be a valid GitHub slug (owner/repo)`);
    }

    let subtreePublishRecipe = null;
    if (releaseConfig.subtreePublishRecipe !== undefined) {
        if (typeof releaseConfig.subtreePublishRecipe !== "string") {
            throw new Error(`${manifestPath} piRelease.subtreePublishRecipe must be a string`);
        }

        const normalizedRecipe = releaseConfig.subtreePublishRecipe.trim();
        if (normalizedRecipe.length > 0) {
            subtreePublishRecipe = normalizedRecipe;
        }
    }

    return {
        repo,
        branch: releaseConfig.branch.trim(),
        subtreePublishRecipe,
    };
}

function buildReleaseRegistry(manifestPaths) {
    const definitionsById = new Map();
    const packageIdByDir = new Map();

    for (const manifestPath of manifestPaths) {
        const manifest = readManifest(manifestPath);

        if (typeof manifest.name !== "string" || manifest.name.trim().length === 0) {
            throw new Error(`${manifestPath} must define a non-empty name`);
        }

        if (typeof manifest.version !== "string") {
            throw new Error(`${manifestPath} must define a string version`);
        }

        const releaseConfig = readPiReleaseConfig(manifestPath, manifest);
        const packageId = manifest.name;
        const packageDir = normalizePath(path.dirname(manifestPath));

        if (definitionsById.has(packageId)) {
            throw new Error(`Duplicate release package name: ${packageId}`);
        }

        if (packageIdByDir.has(packageDir)) {
            throw new Error(`Directory ${packageDir} has multiple release packages`);
        }

        definitionsById.set(packageId, {
            packageId,
            manifestPath,
            packageDir,
            npmPublishCwd: packageDir === "." ? "." : packageDir,
            repo: releaseConfig.repo,
            branch: releaseConfig.branch,
            subtreePublishRecipe: releaseConfig.subtreePublishRecipe,
        });

        packageIdByDir.set(packageDir, packageId);
    }

    return {
        manifestPaths,
        definitionsById,
        packageIdByDir,
    };
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

function parentDirectoryKey(directory) {
    if (directory === ".") {
        return null;
    }

    const parent = normalizePath(path.dirname(directory));
    return parent === directory ? null : parent;
}

function propagationChainFor(targetPackageId, registry) {
    const chain = [targetPackageId];
    let currentDirectory = registry.definitionsById.get(targetPackageId)?.packageDir;

    if (!currentDirectory) {
        throw new Error(`Unknown release package: ${targetPackageId}`);
    }

    while (true) {
        const parentDirectory = parentDirectoryKey(currentDirectory);
        if (parentDirectory === null) {
            break;
        }

        const parentPackageId = registry.packageIdByDir.get(parentDirectory);
        if (parentPackageId && !chain.includes(parentPackageId)) {
            chain.push(parentPackageId);
        }

        currentDirectory = parentDirectory;
    }

    return chain;
}

function planForTarget(target, bump, registry) {
    const targetDefinition = registry.definitionsById.get(target);
    if (!targetDefinition) {
        const knownTargets = [...registry.definitionsById.keys()].sort().join(", ");
        throw new Error(`Unknown target: ${target}. Known targets: ${knownTargets}`);
    }

    const packageIds = propagationChainFor(target, registry);

    return packageIds.map((packageId) => {
        const definition = registry.definitionsById.get(packageId);
        if (!definition) {
            throw new Error(`Missing release definition for ${packageId}`);
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

        return {
            packageId,
            definition,
            manifest,
            from: manifest.version,
            to: bumpSemver(manifest.version, bump),
        };
    });
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

    run("git", ["add", ...unique(changedManifestPaths)], { dryRun: options.dryRun });
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

function printValidationSummary(registry) {
    console.log("Release config validation OK.\n");
    console.log("Release manifests:");
    for (const manifestPath of registry.manifestPaths) {
        console.log(`- ${manifestPath}`);
    }

    console.log("\nRelease targets:");
    const packageIds = [...registry.definitionsById.keys()].sort();
    for (const packageId of packageIds) {
        const definition = registry.definitionsById.get(packageId);
        if (!definition) {
            continue;
        }

        console.log(`- ${packageId} (${definition.manifestPath})`);
    }
}

function main() {
    const options = parseArgs(process.argv.slice(2));
    const manifestPaths = collectReleaseManifestPaths();
    const registry = buildReleaseRegistry(manifestPaths);

    if (options.validate) {
        printValidationSummary(registry);
        return;
    }

    const plan = planForTarget(options.target, options.bump, registry);
    printPlan(options.target, options.bump, plan, options.dryRun);
    executeRelease(options, plan);
}

main();
