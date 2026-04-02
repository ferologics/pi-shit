export type ProIntent = "general" | "plan" | "review" | "architecture" | "debug" | "analyze";

export type TranscriptScope = "origin" | "last-import" | "none";

export type ContextSource =
    | { kind: "paths"; specs: string[] }
    | { kind: "changed"; ref?: string }
    | { kind: "diff"; ref?: string };

export interface ContextSelection {
    transcript: TranscriptScope;
    sources: ContextSource[];
    expansion: {
        dependents: boolean;
        docs: boolean;
        tests: boolean;
    };
    budget: number;
}

export interface ProContextDefaults {
    projectDir: string;
    budget: number;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
}

export interface ManualHandoffStep {
    state: "done" | "skipped" | "failed";
    detail: string;
}

export interface ManualHandoffStatus {
    clipboard: ManualHandoffStep;
    reveal: ManualHandoffStep;
}

export interface PendingManualPass {
    passNumber: number;
    artifactPrefix: string;
    prompt: string;
    intent: ProIntent;
    transcriptScope: TranscriptScope;
    contextSelection: ContextSelection;
    requestPath: string;
    responsePath: string;
    metaPath: string;
    submitPath: string;
    preparedAt: number;
    handoff: ManualHandoffStatus;
    packPath?: string;
}

export interface ProRunState {
    active: boolean;
    anchorEntryId?: string;
    artifactDir?: string;
    startedAt?: number;
    updatedAt?: number;
    passCount: number;
    latestArtifactPrefix?: string;
    latestRequestPath?: string;
    latestPackPath?: string;
    latestSubmitPath?: string;
    latestResponsePath?: string;
    lastImportEntryId?: string;
    pendingPass?: PendingManualPass;
    defaults?: ProContextDefaults;
    lastSelection?: ContextSelection;
}

export interface ProPassOptions {
    prompt: string;
    intent: ProIntent;
    transcriptScope: TranscriptScope;
    projectDir: string;
    pathSpecs: string[];
    changedRef?: string;
    diffRef?: string;
    budget: number;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
    noCode: boolean;
    reuseContext: boolean;
}

export interface ParsedCommand {
    subcommand: "help" | "start" | "pass" | "import" | "return" | "status" | "stop";
    options?: ProPassOptions;
    inputPath?: string;
}

export interface CountTokensResult {
    tokens: number;
    method: "tokencount" | "estimate";
}

export interface PackedFile {
    path: string;
    content: string;
    tokens: number;
}

export interface OmittedFile {
    path: string;
    reason: string;
}

export interface ContextPackResult {
    packPath: string;
    projectDir: string;
    seedFiles: PackedFile[];
    relatedFiles: PackedFile[];
    omittedFiles: OmittedFile[];
    diffText?: string;
    diffRef?: string;
    warnings: string[];
    tokenCount: CountTokensResult;
}

export interface ArtifactPaths {
    artifactPrefix: string;
    requestPath: string;
    responsePath: string;
    submitPath: string;
    metaPath: string;
    packPath?: string;
}
