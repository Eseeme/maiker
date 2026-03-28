import type { ValidatorResult, MaikerConfig, Issue } from '../../types/index.js';
export interface VisualValidationOptions {
    runId: string;
    projectPath: string;
    config: MaikerConfig;
    taskConstraints: string[];
    baseDir?: string;
    onOutput?: (line: string) => void;
}
export interface VisualValidationResult {
    playwrightResult?: ValidatorResult;
    screenshotResult?: ValidatorResult;
    visualReviewResult?: ValidatorResult;
    issues: Issue[];
    screenshotPaths: string[];
}
export declare function runVisualValidation(opts: VisualValidationOptions): Promise<VisualValidationResult>;
//# sourceMappingURL=index.d.ts.map