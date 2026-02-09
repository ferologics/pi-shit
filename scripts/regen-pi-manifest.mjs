import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const packageJsonPath = path.join(root, "package.json");

function toPosix(value) {
    return value.split(path.sep).join("/");
}

function listDirectoriesWithMarker(baseDir, markerFile) {
    const absoluteBaseDir = path.join(root, baseDir);
    if (!fs.existsSync(absoluteBaseDir)) {
        return [];
    }

    return fs
        .readdirSync(absoluteBaseDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => path.join(baseDir, entry.name, markerFile))
        .filter((relativePath) => fs.existsSync(path.join(root, relativePath)))
        .map(toPosix)
        .sort();
}

function listThemeFiles(baseDir) {
    const absoluteBaseDir = path.join(root, baseDir);
    if (!fs.existsSync(absoluteBaseDir)) {
        return [];
    }

    return fs
        .readdirSync(absoluteBaseDir, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map((entry) => toPosix(path.join(baseDir, entry.name)))
        .sort();
}

const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));

const extensions = listDirectoriesWithMarker("extensions", "index.ts");
const skills = listDirectoriesWithMarker("skills", "SKILL.md");
const themes = listThemeFiles("themes");

if (extensions.length === 0) {
    throw new Error("No extensions discovered. Expected extensions/*/index.ts files.");
}

if (skills.length === 0) {
    throw new Error("No skills discovered. Expected skills/*/SKILL.md files.");
}

packageJson.pi = packageJson.pi || {};
packageJson.pi.extensions = extensions;
packageJson.pi.skills = skills;
packageJson.pi.themes = themes.length > 0 ? themes : ["themes"];

fs.writeFileSync(packageJsonPath, `${JSON.stringify(packageJson, null, 4)}\n`, "utf8");

console.log(
    `✓ Regenerated pi manifest (${extensions.length} extensions, ${skills.length} skills, ${themes.length} themes)`,
);
