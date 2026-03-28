import type { PackageManager } from '../../types/index.js';
export declare function detectTestRunner(cwd: string): Promise<'jest' | 'vitest' | 'mocha' | 'none'>;
export declare function runUnitTests(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
}>;
export declare function runTestsWithCoverage(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
    coveragePath?: string;
}>;
//# sourceMappingURL=index.d.ts.map