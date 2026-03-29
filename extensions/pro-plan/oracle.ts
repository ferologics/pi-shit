import { execFile, spawn } from "node:child_process";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { OracleRunOptions, OracleRunResult } from "./types.js";

const execFileAsync = promisify(execFile);

async function commandExists(command: string, args: string[]): Promise<boolean> {
    try {
        await execFileAsync(command, args, { maxBuffer: 1024 * 1024 });
        return true;
    } catch {
        return false;
    }
}

async function resolveOracleCommand(): Promise<{ command: string; prefixArgs: string[] }> {
    if (await commandExists("oracle", ["--version"])) {
        return { command: "oracle", prefixArgs: [] };
    }

    if (await commandExists("npx", ["--version"])) {
        return { command: "npx", prefixArgs: ["-y", "@steipete/oracle"] };
    }

    throw new Error("Neither `oracle` nor `npx` is available. Install Oracle or ensure npx is in PATH.");
}

function shortPrompt(): string {
    return "Read the attached planning request carefully. If a context pack is attached, use it as the source of code context. Produce only the requested planning output.";
}

export async function runOracleBrowser(options: OracleRunOptions): Promise<OracleRunResult> {
    const resolved = await resolveOracleCommand();
    const args = [
        ...resolved.prefixArgs,
        "--engine",
        "browser",
        "--model",
        "gpt-5.4-pro",
        "--browser-model-strategy",
        "select",
        "--wait",
        "--write-output",
        options.responsePath,
        "--prompt",
        shortPrompt(),
        "--file",
        options.requestPath,
    ];

    if (options.packPath) {
        args.push("--file", options.packPath);
    }

    await writeFile(
        options.logPath,
        `> ${resolved.command} ${args.map((value) => JSON.stringify(value)).join(" ")}\n\n`,
        "utf8",
    );

    return new Promise<OracleRunResult>((resolve, reject) => {
        const detached = process.platform !== "win32";
        const child = spawn(resolved.command, args, {
            stdio: ["ignore", "pipe", "pipe"],
            env: process.env,
            detached,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        let killTimeout: ReturnType<typeof setTimeout> | null = null;

        const finish = async (result: OracleRunResult) => {
            if (settled) {
                return;
            }
            settled = true;
            await appendFile(
                options.logPath,
                `\n[exit ${result.exitCode}]\n\n[stdout]\n${result.stdout}\n\n[stderr]\n${result.stderr}\n`,
                "utf8",
            );
            resolve(result);
        };

        const fail = async (error: Error) => {
            if (settled) {
                return;
            }
            settled = true;
            await appendFile(options.logPath, `\n[error]\n${error.message}\n`, "utf8");
            reject(error);
        };

        child.stdout.on("data", (chunk: Buffer | string) => {
            stdout += chunk.toString();
        });

        child.stderr.on("data", (chunk: Buffer | string) => {
            stderr += chunk.toString();
        });

        child.on("error", (error) => {
            void fail(error instanceof Error ? error : new Error(String(error)));
        });

        child.on("close", (code) => {
            if (killTimeout) {
                clearTimeout(killTimeout);
                killTimeout = null;
            }
            void finish({
                stdout,
                stderr,
                exitCode: code ?? -1,
            });
        });

        options.signal?.addEventListener(
            "abort",
            () => {
                const terminate = (signal: NodeJS.Signals): void => {
                    try {
                        if (detached && child.pid) {
                            process.kill(-child.pid, signal);
                            return;
                        }
                        child.kill(signal);
                    } catch {
                        // process already exited
                    }
                };

                terminate("SIGTERM");
                killTimeout = setTimeout(() => {
                    terminate("SIGKILL");
                }, 2000);
            },
            { once: true },
        );
    });
}

export async function readOracleResponse(responsePath: string): Promise<string> {
    const content = await readFile(responsePath, "utf8");
    return content.trim();
}
