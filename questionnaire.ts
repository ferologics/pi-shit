/**
 * Questionnaire Tool - Unified tool for asking single or multiple questions
 * 
 * Single question: simple options list
 * Multiple questions: tab bar navigation between questions
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { DynamicBorder } from "@mariozechner/pi-coding-agent";
import { Container, Text, Editor, type EditorTheme, matchesKey, Key, truncateToWidth, visibleWidth } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

// Types
interface QuestionOption {
	value: string;
	label: string;
	description?: string;
}

interface Question {
	id: string;
	label?: string;
	prompt: string;
	options: QuestionOption[];
	allowOther?: boolean;
}

interface Answer {
	id: string;
	value: string;
	label: string;
	wasCustom: boolean;
}

interface QuestionnaireDetails {
	questions: Question[];
	answers: Answer[];
	cancelled: boolean;
}

// Schema
const QuestionOptionSchema = Type.Object({
	value: Type.String({ description: "The value returned when selected" }),
	label: Type.String({ description: "Display label for the option" }),
	description: Type.Optional(Type.String({ description: "Optional description shown below label" })),
});

const QuestionSchema = Type.Object({
	id: Type.String({ description: "Unique identifier for this question" }),
	label: Type.Optional(Type.String({ description: "Short label for tab bar (defaults to Q1, Q2, etc.)" })),
	prompt: Type.String({ description: "The full question text to display" }),
	options: Type.Array(QuestionOptionSchema, { description: "Available options to choose from" }),
	allowOther: Type.Optional(Type.Boolean({ description: "Allow 'Type something' option (default: true)" })),
});

const QuestionnaireParams = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "Questions to ask the user" }),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "questionnaire",
		label: "Questionnaire",
		description: "Ask the user one or more questions. Use for clarifying requirements, getting preferences, or confirming decisions. For single questions, shows a simple option list. For multiple questions, shows a tab-based interface.",
		parameters: QuestionnaireParams,

		async execute(_toolCallId, params, _onUpdate, ctx, _signal) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "Error: UI not available (running in non-interactive mode)" }],
					details: { questions: params.questions, answers: [], cancelled: true } as QuestionnaireDetails,
				};
			}

			if (params.questions.length === 0) {
				return {
					content: [{ type: "text", text: "Error: No questions provided" }],
					details: { questions: [], answers: [], cancelled: true } as QuestionnaireDetails,
				};
			}

			// Normalize questions - add default labels
			const questions: Question[] = params.questions.map((q, i) => ({
				...q,
				label: q.label || `Q${i + 1}`,
				allowOther: q.allowOther !== false, // default true
			}));

			const isMultiQuestion = questions.length > 1;

			// Run the questionnaire UI
			const result = await ctx.ui.custom<QuestionnaireDetails>((tui, theme, _kb, done) => {
				// State
				let currentTab = 0; // 0 to questions.length (last is Submit)
				let optionIndex = 0;
				const answers = new Map<string, Answer>();
				let cachedLines: string[] | undefined;
				
				// Input mode state
				let inputMode = false;
				let inputQuestionId: string | null = null;
				
				// Create editor with theme
				const editorTheme: EditorTheme = {
					borderColor: (s: string) => theme.fg("accent", s),
					selectList: {
						selectedPrefix: (t: string) => theme.fg("accent", t),
						selectedText: (t: string) => theme.fg("accent", t),
						description: (t: string) => theme.fg("muted", t),
						scrollInfo: (t: string) => theme.fg("dim", t),
						noMatch: (t: string) => theme.fg("warning", t),
					},
				};
				const editorComponent = new Editor(editorTheme);

				const totalTabs = questions.length + 1; // questions + Submit
				
				// Setup editor callbacks
				editorComponent.onSubmit = (value) => {
					if (inputQuestionId) {
						const trimmedValue = value.trim();
						answers.set(inputQuestionId, {
							id: inputQuestionId,
							value: trimmedValue || "(no response)",
							label: trimmedValue || "(no response)",
							wasCustom: true,
						});
						
						// Auto-advance
						if (isMultiQuestion && currentTab < questions.length - 1) {
							currentTab++;
							optionIndex = 0;
						} else if (isMultiQuestion) {
							currentTab = questions.length;
							optionIndex = 0;
						} else {
							// Single question - submit immediately
							done({
								questions,
								answers: Array.from(answers.values()),
								cancelled: false,
							});
							return;
						}
					}
					inputMode = false;
					inputQuestionId = null;
					editorComponent.setText("");
					invalidate();
					tui.requestRender();
				};

				function getCurrentQuestion(): Question | null {
					if (currentTab < questions.length) {
						return questions[currentTab];
					}
					return null;
				}

				function getOptionsForCurrentQuestion(): { value: string; label: string; description?: string }[] {
					const q = getCurrentQuestion();
					if (!q) return [];
					
					const opts = [...q.options];
					if (q.allowOther) {
						opts.push({ value: "__other__", label: "Type something.", description: undefined });
					}
					return opts;
				}

				function allAnswered(): boolean {
					return questions.every(q => answers.has(q.id));
				}

				function invalidate() {
					cachedLines = undefined;
				}

				function handleInput(data: string) {
					// If in input mode, route to editor component
					if (inputMode) {
						// Handle escape to cancel input mode
						if (matchesKey(data, Key.escape)) {
							inputMode = false;
							inputQuestionId = null;
							editorComponent.setText("");
							invalidate();
							tui.requestRender();
							return;
						}
						editorComponent.handleInput(data);
						invalidate();
						tui.requestRender();
						return;
					}
					
					const q = getCurrentQuestion();
					const opts = getOptionsForCurrentQuestion();

					// Navigation between tabs (multi-question mode)
					if (isMultiQuestion) {
						if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
							currentTab = (currentTab + 1) % totalTabs;
							optionIndex = 0;
							invalidate();
							tui.requestRender();
							return;
						}
						if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
							currentTab = (currentTab - 1 + totalTabs) % totalTabs;
							optionIndex = 0;
							invalidate();
							tui.requestRender();
							return;
						}
					}

					// On Submit tab
					if (currentTab === questions.length) {
						if (matchesKey(data, Key.enter)) {
							if (allAnswered()) {
								done({
									questions,
									answers: Array.from(answers.values()),
									cancelled: false,
								});
							}
							return;
						}
						if (matchesKey(data, Key.escape)) {
							done({ questions, answers: [], cancelled: true });
							return;
						}
						return;
					}

					// Navigate options
					if (matchesKey(data, Key.up)) {
						optionIndex = Math.max(0, optionIndex - 1);
						invalidate();
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.down)) {
						optionIndex = Math.min(opts.length - 1, optionIndex + 1);
						invalidate();
						tui.requestRender();
						return;
					}

					// Select option
					if (matchesKey(data, Key.enter) && q) {
						const selectedOpt = opts[optionIndex];
						if (selectedOpt.value === "__other__") {
							// Enter input mode
							inputMode = true;
							inputQuestionId = q.id;
							editorComponent.setText("");
							invalidate();
							tui.requestRender();
							return;
						}
						
						answers.set(q.id, {
							id: q.id,
							value: selectedOpt.value,
							label: selectedOpt.label,
							wasCustom: false,
						});

						// Auto-advance to next tab in multi-question mode
						if (isMultiQuestion && currentTab < questions.length - 1) {
							currentTab++;
							optionIndex = 0;
						} else if (isMultiQuestion) {
							// Go to Submit
							currentTab = questions.length;
							optionIndex = 0;
						} else {
							// Single question - submit immediately
							done({
								questions,
								answers: Array.from(answers.values()),
								cancelled: false,
							});
							return;
						}
						invalidate();
						tui.requestRender();
						return;
					}

					// Cancel
					if (matchesKey(data, Key.escape)) {
						done({ questions, answers: [], cancelled: true });
						return;
					}
				}

				function render(width: number): string[] {
					if (cachedLines) return cachedLines;

					const lines: string[] = [];
					const q = getCurrentQuestion();
					const opts = getOptionsForCurrentQuestion();

					// Top border
					lines.push(theme.fg("accent", "─".repeat(width)));

					// Tab bar (only for multi-question)
					if (isMultiQuestion) {
						let tabLine = " ";
						
						// Left arrow
						tabLine += theme.fg("dim", "← ");

						// Question tabs
						for (let i = 0; i < questions.length; i++) {
							const isActive = i === currentTab;
							const isAnswered = answers.has(questions[i].id);
							const label = questions[i].label || `Q${i + 1}`;
							const checkbox = isAnswered ? "■" : "□";
							
							if (isActive) {
								tabLine += theme.fg("accent", `[${checkbox} ${label}]`) + " ";
							} else {
								tabLine += theme.fg(isAnswered ? "success" : "muted", `${checkbox} ${label}`) + " ";
							}
						}

						// Submit tab
						const canSubmit = allAnswered();
						const isSubmitActive = currentTab === questions.length;
						if (isSubmitActive) {
							tabLine += theme.fg(canSubmit ? "accent" : "dim", `[✓ Submit]`);
						} else {
							tabLine += theme.fg(canSubmit ? "success" : "dim", `✓ Submit`);
						}

						// Right arrow
						tabLine += theme.fg("dim", " →");

						lines.push(truncateToWidth(tabLine, width));
						lines.push(""); // spacer
					}

					// Input mode view
					if (inputMode && q) {
						lines.push(theme.fg("text", " " + q.prompt));
						lines.push("");
						lines.push(theme.fg("muted", " Type your answer (Shift+Enter for newline):"));
						
						// Render the editor component
						const editorLines = editorComponent.render(width - 2);
						for (const line of editorLines) {
							lines.push(" " + line);
						}
						
						lines.push("");
						lines.push(theme.fg("dim", " Enter to submit • Esc to cancel"));
					}
					// Question content or Submit view
					else if (currentTab === questions.length) {
						// Submit tab view
						lines.push(theme.fg("accent", theme.bold(" Ready to submit")));
						lines.push("");
						
						// Show summary of answers
						for (const question of questions) {
							const answer = answers.get(question.id);
							if (answer) {
								const prefix = answer.wasCustom ? "(wrote) " : "";
								lines.push(theme.fg("muted", ` ${question.label}: `) + theme.fg("text", prefix + answer.label));
							}
						}
						
						lines.push("");
						if (allAnswered()) {
							lines.push(theme.fg("success", " Press Enter to submit"));
						} else {
							const unanswered = questions.filter(q => !answers.has(q.id)).map(q => q.label).join(", ");
							lines.push(theme.fg("warning", ` Unanswered: ${unanswered}`));
						}
					} else if (q) {
						// Question view
						lines.push(theme.fg("text", " " + q.prompt));
						lines.push("");

						// Options
						for (let i = 0; i < opts.length; i++) {
							const opt = opts[i];
							const isSelected = i === optionIndex;
							const prefix = isSelected ? theme.fg("accent", "> ") : "  ";
							const num = `${i + 1}. `;
							
							if (isSelected) {
								lines.push(prefix + theme.fg("accent", num + opt.label));
							} else {
								lines.push(prefix + theme.fg("text", num + opt.label));
							}
							
							if (opt.description) {
								lines.push("     " + theme.fg("muted", opt.description));
							}
						}
					}

					lines.push(""); // spacer

					// Help text (only if not in input mode)
					if (!inputMode) {
						if (isMultiQuestion) {
							lines.push(theme.fg("dim", " Tab/←→ navigate • ↑↓ select • Enter confirm • Esc cancel"));
						} else {
							lines.push(theme.fg("dim", " ↑↓ navigate • Enter select • Esc cancel"));
						}
					}

					// Bottom border
					lines.push(theme.fg("accent", "─".repeat(width)));

					cachedLines = lines;
					return lines;
				}

				return {
					render,
					invalidate,
					handleInput,
				};
			});

			// Build result
			if (result.cancelled) {
				return {
					content: [{ type: "text", text: "User cancelled the questionnaire" }],
					details: result,
				};
			}

			// Format answers for LLM
			const answerLines = result.answers.map(a => {
				const q = questions.find(q => q.id === a.id);
				const qLabel = q?.label || a.id;
				const prefix = a.wasCustom ? "user wrote: " : "user selected: ";
				return `${qLabel}: ${prefix}${a.label}`;
			});

			return {
				content: [{ type: "text", text: answerLines.join("\n") }],
				details: result,
			};
		},

		renderCall(args, theme) {
			const questions = args.questions as Question[];
			const count = questions?.length || 0;
			const labels = questions?.map(q => q.label || q.id).join(", ") || "";
			
			let text = theme.fg("toolTitle", theme.bold("questionnaire "));
			text += theme.fg("muted", `${count} question${count !== 1 ? "s" : ""}`);
			if (labels) {
				text += theme.fg("dim", ` (${truncateToWidth(labels, 40)})`);
			}
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme) {
			const details = result.details as QuestionnaireDetails | undefined;
			
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.cancelled) {
				return new Text(theme.fg("warning", "Cancelled"), 0, 0);
			}

			// Show summary of answers
			const lines = details.answers.map(a => {
				const prefix = a.wasCustom ? theme.fg("muted", "(wrote) ") : "";
				return theme.fg("success", "✓ ") + theme.fg("accent", a.id) + ": " + prefix + a.label;
			});

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
