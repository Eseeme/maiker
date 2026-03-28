export declare function readFile(filePath: string): Promise<string>;
export declare function writeFile(filePath: string, content: string): Promise<void>;
export declare function fileExists(filePath: string): Promise<boolean>;
export declare function listFiles(dir: string, pattern?: string, ignore?: string[]): Promise<string[]>;
export declare function findFiles(dir: string, extensions: string[], ignore?: string[]): Promise<string[]>;
export declare function readDirectory(dir: string): Promise<string[]>;
export declare function summariseRepo(rootPath: string): Promise<string>;
//# sourceMappingURL=index.d.ts.map