import type { PolicyConfig, TaskClassification, ValidationProfile, ValidatorName } from '../../types/index.js';
export declare function getValidationProfile(classification: TaskClassification): ValidationProfile;
export declare function shouldEscalate(issueId: string, retryCounts: Record<string, number>, policy: PolicyConfig): boolean;
/** Check if we should auto-replan instead of continuing repairs */
export declare function shouldAutoReplan(retryCounts: Record<string, number>, policy: PolicyConfig): boolean;
export declare function shouldContinueRepair(retryCounts: Record<string, number>, policy: PolicyConfig): boolean;
export declare function getRepairCount(issueId: string, retryCounts: Record<string, number>): number;
export declare function analyseContextImpact(message: string, currentStage: string): 'low' | 'medium' | 'high';
export declare function resolveValidators(profile: ValidationProfile, configEnabled: Record<ValidatorName, boolean>): ValidatorName[];
//# sourceMappingURL=index.d.ts.map