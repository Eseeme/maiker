export type ArtifactCategory = 'screenshots' | 'traces' | 'logs' | 'diffs' | 'reports';
export declare function saveArtifact(runId: string, category: ArtifactCategory, filename: string, content: string | Buffer, baseDir?: string): Promise<string>;
export declare function saveScreenshot(runId: string, viewport: string, route: string, imageBuffer: Buffer, baseDir?: string): Promise<string>;
export declare function saveDiff(runId: string, filename: string, content: string, baseDir?: string): Promise<string>;
export declare function saveReport(runId: string, filename: string, content: string, baseDir?: string): Promise<string>;
export declare function saveLog(runId: string, filename: string, content: string, baseDir?: string): Promise<string>;
export declare function saveFinalSummary(runId: string, summary: string, scorecard: Record<string, unknown>, outcome: Record<string, unknown>, baseDir?: string): Promise<void>;
export declare function listArtifacts(runId: string, category?: ArtifactCategory, baseDir?: string): Promise<string[]>;
export declare function writeEscalationPacket(runId: string, packet: {
    summary: string;
    failingIssues: string;
    attemptsCount: number;
    triedSolutions: string[];
    likelyRootCause: string;
    recommendedDecision: string;
}, baseDir?: string): Promise<string>;
//# sourceMappingURL=index.d.ts.map