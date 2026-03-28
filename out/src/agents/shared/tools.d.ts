/**
 * Agent Tool Definitions & Execution
 *
 * Provides actual file system and shell tools that agents can call
 * via the LLM tool-use API. Each tool call is executed on disk.
 */
export declare const AGENT_TOOLS: ({
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: {
            path: {
                type: string;
                description: string;
            };
            content?: undefined;
            command?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: {
            path: {
                type: string;
                description: string;
            };
            content: {
                type: string;
                description: string;
            };
            command?: undefined;
        };
        required: string[];
    };
} | {
    name: string;
    description: string;
    input_schema: {
        type: "object";
        properties: {
            command: {
                type: string;
                description: string;
            };
            path?: undefined;
            content?: undefined;
        };
        required: string[];
    };
})[];
export interface ToolResult {
    output: string;
    isError: boolean;
}
export declare function executeTool(toolName: string, toolInput: Record<string, string>, projectPath: string): Promise<ToolResult>;
//# sourceMappingURL=tools.d.ts.map