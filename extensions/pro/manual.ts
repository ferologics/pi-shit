import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function copyWith(command: string, args: string[], text: string): Promise<void> {
    await new Promise<void>((resolve, reject) => {
        const child = spawn(command, args, {
            stdio: ["pipe", "ignore", "pipe"],
        });

        let stderr = "";
        child.stdin.on("error", () => {
            // ignore broken pipe races
        });
        child.stdin.end(text, "utf8");
        child.stderr.on("data", (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (code) => {
            if (code === 0) {
                resolve();
                return;
            }
            reject(new Error(stderr.trim() || `${command} exited with code ${code ?? -1}`));
        });
    });
}

export async function copyTextToClipboard(text: string): Promise<void> {
    if (process.platform === "darwin") {
        await copyWith("pbcopy", [], text);
        return;
    }

    if (process.platform === "linux") {
        try {
            await copyWith("wl-copy", [], text);
            return;
        } catch {
            await copyWith("xclip", ["-selection", "clipboard"], text);
            return;
        }
    }

    throw new Error(`Clipboard copy is not supported on ${process.platform}`);
}

export async function readTextFromClipboard(): Promise<string> {
    if (process.platform === "darwin") {
        const result = await execFileAsync("pbpaste", [], { maxBuffer: 1024 * 1024 * 20 });
        return result.stdout;
    }

    if (process.platform === "linux") {
        try {
            const result = await execFileAsync("wl-paste", ["--no-newline"], { maxBuffer: 1024 * 1024 * 20 });
            return result.stdout;
        } catch {
            const result = await execFileAsync("xclip", ["-selection", "clipboard", "-o"], {
                maxBuffer: 1024 * 1024 * 20,
            });
            return result.stdout;
        }
    }

    throw new Error(`Clipboard paste is not supported on ${process.platform}`);
}

export async function revealFileForManualUpload(filePath: string): Promise<void> {
    if (process.platform !== "darwin") {
        return;
    }

    await execFileAsync("open", ["-R", filePath], { maxBuffer: 1024 * 1024 });
}
