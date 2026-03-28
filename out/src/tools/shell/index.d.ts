export interface ShellResult {
    stdout: string;
    stderr: string;
    exitCode: number;
    duration: number;
}
export interface ShellOptions {
    cwd?: string;
    env?: NodeJS.ProcessEnv;
    timeout?: number;
    maxBuffer?: number;
}
export declare function runCommand(command: string, args?: string[], opts?: ShellOptions): Promise<ShellResult>;
export declare function runShell(script: string, opts?: ShellOptions): Promise<ShellResult>;
export interface SpawnOptions extends ShellOptions {
    onStdout?: (line: string) => void;
    onStderr?: (line: string) => void;
}
export declare function spawnCommand(command: string, args?: string[], opts?: SpawnOptions): Promise<ShellResult>;
//# sourceMappingURL=index.d.ts.map