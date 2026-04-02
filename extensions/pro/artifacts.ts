import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactPaths, ProRunState } from "./types.js";

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}

function pad3(value: number): string {
    return String(value).padStart(3, "0");
}

function timestampForPath(date = new Date()): string {
    return [
        date.getFullYear(),
        pad2(date.getMonth() + 1),
        pad2(date.getDate()),
        "-",
        pad2(date.getHours()),
        pad2(date.getMinutes()),
        pad2(date.getSeconds()),
        "-",
        pad3(date.getMilliseconds()),
    ].join("");
}

function sanitizeSegment(value: string): string {
    const normalized = value.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
    return normalized.length > 0 ? normalized : "session";
}

export async function createArtifactDir(anchorEntryId: string): Promise<string> {
    const root = path.join(os.homedir(), ".pi", "agent", "pro");
    const cwdName = sanitizeSegment(path.basename(process.cwd()));
    const dir = path.join(root, `${timestampForPath()}-${cwdName}-${anchorEntryId.slice(0, 8)}`);
    await mkdir(dir, { recursive: true });
    return dir;
}

export function artifactPaths(artifactDir: string, passNumber: number, hasPack: boolean): ArtifactPaths {
    const artifactPrefix = `pass-${String(passNumber).padStart(3, "0")}-${timestampForPath()}`;

    return {
        artifactPrefix,
        requestPath: path.join(artifactDir, `${artifactPrefix}.request.md`),
        responsePath: path.join(artifactDir, `${artifactPrefix}.response.md`),
        submitPath: path.join(artifactDir, `${artifactPrefix}.submit.md`),
        metaPath: path.join(artifactDir, `${artifactPrefix}.meta.json`),
        packPath: hasPack ? path.join(artifactDir, `${artifactPrefix}.pack.md`) : undefined,
    };
}

export function artifactPrefixFromPath(filePath: string | undefined): string | undefined {
    if (!filePath) {
        return undefined;
    }

    const baseName = path.basename(filePath);
    return baseName.replace(/\.(request|response|submit|pack)\.md$|\.meta\.json$/, "") || undefined;
}

export async function writeJson(targetPath: string, value: unknown): Promise<void> {
    await writeFile(targetPath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

export async function writeStateFile(artifactDir: string, state: ProRunState): Promise<void> {
    await writeJson(path.join(artifactDir, "state.json"), state);
}
