import { getIntentPreset } from "./presets.js";
import type { ProIntent, TranscriptScope } from "./types.js";

interface BuildPassRequestMarkdownOptions {
    intent: ProIntent;
    prompt: string;
    transcript: string;
    transcriptScope: TranscriptScope;
    transcriptNotes?: string[];
}

function transcriptLabel(scope: TranscriptScope): string {
    switch (scope) {
        case "last-import":
            return "last-import";
        case "none":
            return "none";
        default:
            return "origin";
    }
}

export function buildPassRequestMarkdown(options: BuildPassRequestMarkdownOptions): string {
    const preset = getIntentPreset(options.intent);
    const passPrompt =
        options.prompt.trim().length > 0 ? options.prompt.trim() : "No extra request was provided for this pass.";
    const transcriptSection =
        options.transcriptScope === "none"
            ? "Transcript omitted for this pass."
            : options.transcript.length > 0
              ? options.transcript
              : "No side-thread transcript was captured for this scope.";

    return [
        `# Pro ${preset.title} Request`,
        "",
        `- Generated: ${new Date().toISOString()}`,
        "- Command: /pro pass",
        `- Intent: ${options.intent}`,
        `- Transcript scope: ${transcriptLabel(options.transcriptScope)}`,
        "",
        "## Instructions",
        "",
        "You are helping with a software consultation inside a coding workflow.",
        "Focus on the explicit request for this pass, the side-thread transcript, and any included context pack.",
        "Do not assume code, state, or constraints outside the provided material.",
        ...preset.instructions,
        "",
        "## Expected output shape",
        "",
        ...preset.outputShape,
        "",
        "## Request for this pass",
        "",
        passPrompt,
        "",
        options.transcriptNotes && options.transcriptNotes.length > 0 ? "## Transcript notes" : undefined,
        options.transcriptNotes && options.transcriptNotes.length > 0 ? "" : undefined,
        ...(options.transcriptNotes ?? []),
        options.transcriptNotes && options.transcriptNotes.length > 0 ? "" : undefined,
        "## Side-thread transcript",
        "",
        transcriptSection,
        "",
    ]
        .filter((line): line is string => line !== undefined)
        .join("\n");
}

export function buildSubmissionMarkdown(requestMarkdown: string, packMarkdown?: string): string {
    if (!packMarkdown) {
        return requestMarkdown;
    }

    return [requestMarkdown.trimEnd(), "", "---", "", packMarkdown.trim(), ""].join("\n");
}

export function buildReturnEditorText(response: string): string {
    return [
        "Use this /pro side-thread takeaway as advisory context.",
        "Verify it against the repo and current branch state before acting.",
        "",
        "<pro-takeaway>",
        response.trim(),
        "</pro-takeaway>",
    ].join("\n");
}
