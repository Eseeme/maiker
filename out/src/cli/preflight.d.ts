import type { MaikerConfig } from '../types/index.js';
export interface PreflightOptions {
    goal: string;
    projectPath: string;
    config: MaikerConfig;
    runId: string;
}
export interface PreflightResult {
    confirmed: boolean;
    switchToDryRun?: boolean;
}
export declare function showPreflight(opts: PreflightOptions): Promise<PreflightResult>;
//# sourceMappingURL=preflight.d.ts.map