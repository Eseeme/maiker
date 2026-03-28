import type { PackageManager } from '../../types/index.js';
export declare function detectPackageManager(cwd: string): Promise<PackageManager>;
export declare function getPmCommand(pm: PackageManager): string;
export declare function installDependencies(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
}>;
export declare function runScript(cwd: string, pm: PackageManager, script: string, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
}>;
export declare function runBuild(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
}>;
export declare function runLint(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
}>;
export declare function runTypecheck(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
}>;
export declare function runTests(cwd: string, pm: PackageManager, onOutput?: (line: string) => void): Promise<{
    success: boolean;
    output: string;
    duration: number;
}>;
//# sourceMappingURL=index.d.ts.map