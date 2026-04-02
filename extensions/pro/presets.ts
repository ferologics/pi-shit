import type { ProIntent } from "./types.js";

export interface ProIntentPreset {
    title: string;
    instructions: string[];
    outputShape: string[];
}

export function getIntentPreset(intent: ProIntent): ProIntentPreset {
    switch (intent) {
        case "plan":
            return {
                title: "Planning",
                instructions: [
                    "Produce a decisive implementation-oriented recommendation.",
                    "Prioritize concrete phases, likely touch points, risks, validation, and remaining open questions.",
                ],
                outputShape: [
                    "- Decision",
                    "- Recommended approach",
                    "- Phases / steps",
                    "- Likely files or modules when justified",
                    "- Risks",
                    "- Validation",
                    "- Open questions",
                ],
            };
        case "review":
            return {
                title: "Review",
                instructions: [
                    "Review the provided material critically and prioritize the most important findings.",
                    "Distinguish major issues from minor concerns and include practical next actions.",
                ],
                outputShape: ["- Summary", "- Findings", "- Severity / impact", "- Recommended fixes or follow-ups"],
            };
        case "architecture":
            return {
                title: "Architecture",
                instructions: [
                    "Evaluate the broader design and tradeoffs, not just local code details.",
                    "Call out system boundaries, constraints, and the most sensible direction.",
                ],
                outputShape: [
                    "- Summary",
                    "- Key tradeoffs",
                    "- Recommended direction",
                    "- Risks / caveats",
                    "- Follow-up questions",
                ],
            };
        case "debug":
            return {
                title: "Debugging",
                instructions: [
                    "Focus on diagnosis first.",
                    "Prefer evidence-backed likely causes, validation steps, and concrete fixes over speculation.",
                ],
                outputShape: ["- Most likely causes", "- Evidence / reasoning", "- Validation steps", "- Likely fixes"],
            };
        case "analyze":
            return {
                title: "Analysis",
                instructions: [
                    "Analyze the material carefully and surface the most important implications.",
                    "Prefer structured reasoning and actionable conclusions over vague commentary.",
                ],
                outputShape: ["- Summary", "- Key observations", "- Implications", "- Recommendations"],
            };
        default:
            return {
                title: "Consultation",
                instructions: [
                    "Help with the explicit request for this pass.",
                    "Be concrete, decisive, and useful to an engineer continuing the side-thread.",
                ],
                outputShape: ["- Direct answer", "- Important reasoning", "- Recommended next steps"],
            };
    }
}
