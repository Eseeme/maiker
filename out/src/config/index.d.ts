import type { MaikerConfig, ModelConfig, ValidatorName } from '../types/index.js';
export declare function loadConfig(configPath?: string): MaikerConfig;
export declare function getDefaultConfig(): MaikerConfig;
export declare function getEnabledValidators(config: MaikerConfig): ValidatorName[];
export declare function getModelConfig(config: MaikerConfig, stage: keyof MaikerConfig['models']): ModelConfig;
//# sourceMappingURL=index.d.ts.map