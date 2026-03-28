import type { RunState, MaikerEvent, Issue, ValidatorResult } from '../../types/index.js';
export declare const sym: {
    check: string;
    cross: string;
    warn: string;
    info: string;
    arrow: string;
    bullet: string;
    run: string;
    pause: string;
    repair: string;
};
export declare function banner(): void;
export declare function success(msg: string): void;
export declare function fail(msg: string): void;
export declare function warn(msg: string): void;
export declare function info(msg: string): void;
export declare function log(msg: string): void;
export declare function section(title: string): void;
export declare function renderRunStatus(state: RunState): void;
export declare function renderIssue(issue: Issue): void;
export declare function renderIssueList(issues: Issue[]): void;
export declare function renderValidatorResult(result: ValidatorResult): void;
export declare function renderEvent(evt: MaikerEvent): void;
export declare function renderDashboard(state: RunState): void;
export declare function formatDuration(seconds: number): string;
export declare function table(headers: string[], rows: string[][]): void;
//# sourceMappingURL=index.d.ts.map