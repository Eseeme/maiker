import type { ValidationProfile, ValidationResult, ValidatorResult, MaikerConfig, Issue } from '../../types/index.js';
export interface ValidationEngineOptions {
    runId: string;
    projectPath: string;
    profile: ValidationProfile;
    config: MaikerConfig;
    taskConstraints?: string[];
    baseDir?: string;
    onOutput?: (line: string) => void;
}
export interface FullValidationResult {
    deterministic: ValidationResult;
    visual?: {
        results: ValidatorResult[];
        issues: Issue[];
        screenshotPaths: string[];
    };
    overallPassed: boolean;
}
export declare function runFullValidation(opts: ValidationEngineOptions): Promise<FullValidationResult>;
//# sourceMappingURL=index.d.ts.map