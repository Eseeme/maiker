import type { PlaywrightConfig } from '../../types/index.js';
export interface PlaywrightRunResult {
    success: boolean;
    output: string;
    duration: number;
    reportPath?: string;
    tracePaths?: string[];
}
export interface ScreenshotJob {
    route: string;
    viewport: [number, number];
    outputPath: string;
}
export declare function runPlaywrightE2E(projectPath: string, outputDir: string, config: PlaywrightConfig, onOutput?: (line: string) => void): Promise<PlaywrightRunResult>;
export declare function captureScreenshots(projectPath: string, screenshotsDir: string, config: PlaywrightConfig, onOutput?: (line: string) => void): Promise<string[]>;
export declare function isPlaywrightInstalled(projectPath: string): Promise<boolean>;
export declare function installPlaywright(projectPath: string): Promise<void>;
//# sourceMappingURL=index.d.ts.map