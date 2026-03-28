export interface GitStatus {
    branch: string;
    modified: string[];
    untracked: string[];
    staged: string[];
    clean: boolean;
}
export declare function getGitStatus(cwd: string): Promise<GitStatus>;
export declare function getDiff(cwd: string, ref?: string): Promise<string>;
export declare function getFullDiff(cwd: string, ref?: string): Promise<string>;
export declare function createWorktree(repoPath: string, branch: string, targetPath: string): Promise<string>;
export declare function removeWorktree(repoPath: string, targetPath: string): Promise<void>;
export declare function stageAll(cwd: string): Promise<void>;
export declare function commit(cwd: string, message: string): Promise<string>;
export declare function getCurrentCommit(cwd: string): Promise<string>;
export declare function isGitRepo(cwd: string): Promise<boolean>;
/** Create a lightweight tag as a checkpoint before making changes */
export declare function createCheckpoint(cwd: string, label: string): Promise<string>;
/** Rollback to a previously created checkpoint */
export declare function rollbackToCheckpoint(cwd: string, label: string): Promise<void>;
/** Remove a checkpoint tag after successful completion */
export declare function removeCheckpoint(cwd: string, label: string): Promise<void>;
//# sourceMappingURL=index.d.ts.map