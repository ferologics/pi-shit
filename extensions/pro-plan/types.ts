export type ProPlanMode = "pass" | "final";

export interface ProPlanContextDefaults {
    projectDir: string;
    pathSpecs: string[];
    budget: number;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
}

export interface ProPlanState {
    active: boolean;
    anchorEntryId?: string;
    artifactDir?: string;
    startedAt?: number;
    updatedAt?: number;
    passCount: number;
    latestMode?: ProPlanMode;
    latestRequestPath?: string;
    latestPackPath?: string;
    latestResponsePath?: string;
    latestLogPath?: string;
    finalResponsePath?: string;
    defaults?: ProPlanContextDefaults;
}

export interface ProPlanPassOptions {
    mode: ProPlanMode;
    prompt: string;
    projectDir: string;
    pathSpecs: string[];
    budget: number;
    includeDependents: boolean;
    includeDocs: boolean;
    includeTests: boolean;
    noCode: boolean;
}

export interface ParsedCommand {
    subcommand: "help" | "start" | "pass" | "final" | "apply" | "status" | "stop";
    options?: ProPlanPassOptions;
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
    warnings: string[];
    tokenCount: CountTokensResult;
}

export interface OracleRunOptions {
    requestPath: string;
    responsePath: string;
    logPath: string;
    packPath?: string;
    signal?: AbortSignal;
}

export interface OracleRunResult {
    stdout: string;
    stderr: string;
    exitCode: number;
}

export interface ArtifactPaths {
    requestPath: string;
    responsePath: string;
    logPath: string;
    metaPath: string;
    packPath?: string;
}
