import { getMarkdownTheme, type ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Markdown } from "@mariozechner/pi-tui";
import type { SessionMessageEntry } from "./transcript.js";
import { defaultState, handleCommand, restoreStateFromEntries, setIdleStatus } from "./workflow.js";

const MARKDOWN_THEME = getMarkdownTheme();

function renderableText(content: unknown): string {
    if (typeof content === "string") {
        return content;
    }

    if (!Array.isArray(content)) {
        return "";
    }

    return content
        .map((block) => {
            if (!block || typeof block !== "object") {
                return "[non-text content omitted]";
            }

            const typed = block as { type?: string; text?: string };
            if (typed.type === "text" && typeof typed.text === "string") {
                return typed.text;
            }

            return "[non-text content omitted]";
        })
        .join("\n");
}

export default function proExtension(pi: ExtensionAPI): void {
    let state = defaultState();

    const markdownTypes = ["pro-help", "pro-status", "pro-response", "pro-error"];
    for (const customType of markdownTypes) {
        pi.registerMessageRenderer(customType, (message) => {
            return new Markdown(renderableText(message.content), 0, 0, MARKDOWN_THEME);
        });
    }

    pi.on("session_start", async (_event, ctx) => {
        const entries = ctx.sessionManager.getEntries() as SessionMessageEntry[];
        state = restoreStateFromEntries(entries);
        setIdleStatus(ctx, state);
    });

    pi.on("session_shutdown", async (_event, ctx) => {
        ctx.ui.setWorkingMessage();
        setIdleStatus(ctx, state);
    });

    pi.registerCommand("pro", {
        description: "Branch-scoped ChatGPT Pro consultation workflow",
        handler: async (rawArgs, ctx) => handleCommand(pi, state, ctx, rawArgs),
    });
}
