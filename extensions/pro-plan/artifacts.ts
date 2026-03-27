import { mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { ArtifactPaths, ProPlanMode, ProPlanState } from "./types.js";

function pad2(value: number): string {
    return String(value).padStart(2, "0");
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
    ].join("");
}

function sanitizeSegment(value: string): string {
    const normalized = value.replace(/\s+/g, "-").replace(/[^A-Za-z0-9._-]/g, "");
    return normalized.length > 0 ? normalized : "session";
}

export async function createArtifactDir(anchorEntryId: string): Promise<string> {
    const root = path.join(os.homedir(), ".pi", "agent", "pro-plan");
    const cwdName = sanitizeSegment(path.basename(process.cwd()));
    const dir = path.join(root, `${timestampForPath()}-${cwdName}-${anchorEntryId.slice(0, 8)}`);
    await mkdir(dir, { recursive: true });
    return dir;
}

export function artifactPaths(
    artifactDir: string,
    passNumber: number,
    mode: ProPlanMode,
    hasPack: boolean,
): ArtifactPaths {
    const base = `${mode}-${String(passNumber).padStart(3, "0")}`;

    return {
        requestPath: path.join(artifactDir, `${base}.request.md`),
        responsePath: path.join(artifactDir, `${base}.response.md`),
        logPath: path.join(artifactDir, `${base}.oracle.log`),
        metaPath: path.join(artifactDir, `${base}.meta.json`),
        packPath: hasPack ? path.join(artifactDir, `${base}.pack.md`) : undefined,
    };
}

export async function writeJson(targetPath: string, value: unknown): Promise<void> {
    await writeFile(targetPath, `${JSON.stringify(value, null, 4)}\n`, "utf8");
}

export async function writeStateFile(artifactDir: string, state: ProPlanState): Promise<void> {
    await writeJson(path.join(artifactDir, "state.json"), state);
}
