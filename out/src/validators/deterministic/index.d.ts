import type { ValidatorName, ValidatorResult, MaikerConfig } from '../../types/index.js';
export interface DeterministicRunOptions {
    runId: string;
    projectPath: string;
    validators: ValidatorName[];
    config: MaikerConfig;
    onOutput?: (line: string) => void;
}
export declare function runDeterministicValidators(opts: DeterministicRunOptions): Promise<ValidatorResult[]>;
//# sourceMappingURL=index.d.ts.map