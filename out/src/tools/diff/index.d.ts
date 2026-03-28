export declare function generateDiff(cwd: string, fromRef?: string): Promise<string>;
export declare function summariseDiff(diffContent: string): Promise<{
    addedLines: number;
    removedLines: number;
    changedFiles: string[];
}>;
export declare function saveDiffReport(runDir: string, diffContent: string, label: string): Promise<string>;
//# sourceMappingURL=index.d.ts.map