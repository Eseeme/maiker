import { z } from 'zod';
export declare const IssueSchema: z.ZodObject<{
    id: z.ZodString;
    category: z.ZodEnum<["layout", "behavior", "performance", "accessibility", "build", "test", "type", "lint", "other"]>;
    severity: z.ZodEnum<["low", "medium", "high", "critical"]>;
    stage: z.ZodString;
    page: z.ZodOptional<z.ZodString>;
    viewport: z.ZodOptional<z.ZodString>;
    selector: z.ZodOptional<z.ZodString>;
    observed: z.ZodString;
    expected: z.ZodString;
    repairHint: z.ZodOptional<z.ZodString>;
    status: z.ZodEnum<["open", "resolved", "escalated", "wont_fix"]>;
    attempts: z.ZodNumber;
    createdAt: z.ZodString;
    resolvedAt: z.ZodOptional<z.ZodString>;
    evidenceRefs: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
}, "strip", z.ZodTypeAny, {
    id: string;
    status: "open" | "resolved" | "escalated" | "wont_fix";
    createdAt: string;
    stage: string;
    severity: "low" | "medium" | "high" | "critical";
    category: "build" | "lint" | "accessibility" | "layout" | "behavior" | "performance" | "test" | "type" | "other";
    expected: string;
    observed: string;
    attempts: number;
    viewport?: string | undefined;
    evidenceRefs?: string[] | undefined;
    page?: string | undefined;
    selector?: string | undefined;
    repairHint?: string | undefined;
    resolvedAt?: string | undefined;
}, {
    id: string;
    status: "open" | "resolved" | "escalated" | "wont_fix";
    createdAt: string;
    stage: string;
    severity: "low" | "medium" | "high" | "critical";
    category: "build" | "lint" | "accessibility" | "layout" | "behavior" | "performance" | "test" | "type" | "other";
    expected: string;
    observed: string;
    attempts: number;
    viewport?: string | undefined;
    evidenceRefs?: string[] | undefined;
    page?: string | undefined;
    selector?: string | undefined;
    repairHint?: string | undefined;
    resolvedAt?: string | undefined;
}>;
export declare const ValidationResultSchema: z.ZodObject<{
    stage: z.ZodEnum<["deterministic", "visual"]>;
    results: z.ZodArray<z.ZodObject<{
        name: z.ZodString;
        status: z.ZodEnum<["pending", "running", "passed", "failed", "skipped"]>;
        duration: z.ZodOptional<z.ZodNumber>;
        output: z.ZodOptional<z.ZodString>;
        error: z.ZodOptional<z.ZodString>;
        artifacts: z.ZodOptional<z.ZodArray<z.ZodString, "many">>;
    }, "strip", z.ZodTypeAny, {
        name: string;
        status: "pending" | "running" | "failed" | "skipped" | "passed";
        error?: string | undefined;
        output?: string | undefined;
        duration?: number | undefined;
        artifacts?: string[] | undefined;
    }, {
        name: string;
        status: "pending" | "running" | "failed" | "skipped" | "passed";
        error?: string | undefined;
        output?: string | undefined;
        duration?: number | undefined;
        artifacts?: string[] | undefined;
    }>, "many">;
    passed: z.ZodBoolean;
    failedCount: z.ZodNumber;
    startedAt: z.ZodString;
    completedAt: z.ZodString;
}, "strip", z.ZodTypeAny, {
    passed: boolean;
    completedAt: string;
    stage: "deterministic" | "visual";
    results: {
        name: string;
        status: "pending" | "running" | "failed" | "skipped" | "passed";
        error?: string | undefined;
        output?: string | undefined;
        duration?: number | undefined;
        artifacts?: string[] | undefined;
    }[];
    failedCount: number;
    startedAt: string;
}, {
    passed: boolean;
    completedAt: string;
    stage: "deterministic" | "visual";
    results: {
        name: string;
        status: "pending" | "running" | "failed" | "skipped" | "passed";
        error?: string | undefined;
        output?: string | undefined;
        duration?: number | undefined;
        artifacts?: string[] | undefined;
    }[];
    failedCount: number;
    startedAt: string;
}>;
export declare const RunStateSchema: z.ZodObject<{
    runId: z.ZodString;
    projectPath: z.ZodString;
    goal: z.ZodString;
    status: z.ZodEnum<["pending", "running", "paused", "done", "failed", "blocked"]>;
    currentStage: z.ZodString;
    currentAgent: z.ZodOptional<z.ZodString>;
    currentAction: z.ZodOptional<z.ZodString>;
    retryCounts: z.ZodRecord<z.ZodString, z.ZodNumber>;
    openIssues: z.ZodArray<z.ZodString, "many">;
    resolvedIssues: z.ZodArray<z.ZodString, "many">;
    contextUpdates: z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        message: z.ZodString;
        impact: z.ZodEnum<["low", "medium", "high"]>;
        action: z.ZodString;
        addedAt: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        id: string;
        message: string;
        impact: "low" | "medium" | "high";
        action: string;
        addedAt: string;
    }, {
        id: string;
        message: string;
        impact: "low" | "medium" | "high";
        action: string;
        addedAt: string;
    }>, "many">;
    createdAt: z.ZodString;
    lastUpdatedAt: z.ZodString;
    completedAt: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    runId: string;
    projectPath: string;
    goal: string;
    status: "pending" | "running" | "paused" | "done" | "failed" | "blocked";
    currentStage: string;
    retryCounts: Record<string, number>;
    openIssues: string[];
    resolvedIssues: string[];
    contextUpdates: {
        id: string;
        message: string;
        impact: "low" | "medium" | "high";
        action: string;
        addedAt: string;
    }[];
    createdAt: string;
    lastUpdatedAt: string;
    currentAgent?: string | undefined;
    currentAction?: string | undefined;
    completedAt?: string | undefined;
}, {
    runId: string;
    projectPath: string;
    goal: string;
    status: "pending" | "running" | "paused" | "done" | "failed" | "blocked";
    currentStage: string;
    retryCounts: Record<string, number>;
    openIssues: string[];
    resolvedIssues: string[];
    contextUpdates: {
        id: string;
        message: string;
        impact: "low" | "medium" | "high";
        action: string;
        addedAt: string;
    }[];
    createdAt: string;
    lastUpdatedAt: string;
    currentAgent?: string | undefined;
    currentAction?: string | undefined;
    completedAt?: string | undefined;
}>;
export declare function validateIssue(data: unknown): z.SafeParseReturnType<{
    id: string;
    status: "open" | "resolved" | "escalated" | "wont_fix";
    createdAt: string;
    stage: string;
    severity: "low" | "medium" | "high" | "critical";
    category: "build" | "lint" | "accessibility" | "layout" | "behavior" | "performance" | "test" | "type" | "other";
    expected: string;
    observed: string;
    attempts: number;
    viewport?: string | undefined;
    evidenceRefs?: string[] | undefined;
    page?: string | undefined;
    selector?: string | undefined;
    repairHint?: string | undefined;
    resolvedAt?: string | undefined;
}, {
    id: string;
    status: "open" | "resolved" | "escalated" | "wont_fix";
    createdAt: string;
    stage: string;
    severity: "low" | "medium" | "high" | "critical";
    category: "build" | "lint" | "accessibility" | "layout" | "behavior" | "performance" | "test" | "type" | "other";
    expected: string;
    observed: string;
    attempts: number;
    viewport?: string | undefined;
    evidenceRefs?: string[] | undefined;
    page?: string | undefined;
    selector?: string | undefined;
    repairHint?: string | undefined;
    resolvedAt?: string | undefined;
}>;
export declare function validateRunState(data: unknown): z.SafeParseReturnType<{
    runId: string;
    projectPath: string;
    goal: string;
    status: "pending" | "running" | "paused" | "done" | "failed" | "blocked";
    currentStage: string;
    retryCounts: Record<string, number>;
    openIssues: string[];
    resolvedIssues: string[];
    contextUpdates: {
        id: string;
        message: string;
        impact: "low" | "medium" | "high";
        action: string;
        addedAt: string;
    }[];
    createdAt: string;
    lastUpdatedAt: string;
    currentAgent?: string | undefined;
    currentAction?: string | undefined;
    completedAt?: string | undefined;
}, {
    runId: string;
    projectPath: string;
    goal: string;
    status: "pending" | "running" | "paused" | "done" | "failed" | "blocked";
    currentStage: string;
    retryCounts: Record<string, number>;
    openIssues: string[];
    resolvedIssues: string[];
    contextUpdates: {
        id: string;
        message: string;
        impact: "low" | "medium" | "high";
        action: string;
        addedAt: string;
    }[];
    createdAt: string;
    lastUpdatedAt: string;
    currentAgent?: string | undefined;
    currentAction?: string | undefined;
    completedAt?: string | undefined;
}>;
//# sourceMappingURL=index.d.ts.map