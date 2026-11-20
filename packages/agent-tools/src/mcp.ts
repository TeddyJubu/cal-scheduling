import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { CalClient } from "./client.js";
import { getTools } from "./tools.js";

export function createMcpServer(client: CalClient, options: { readOnly?: boolean } = {}) {
  const server = new McpServer({ name: "cal-mcp", version: "0.2.0" });
  for (const entry of getTools(options)) {
    server.registerTool(
      entry.name,
      {
        description: entry.description,
        inputSchema: entry.inputSchema.shape,
        annotations: { readOnlyHint: !entry.mutating, destructiveHint: entry.mutating },
      },
      async (input: unknown): Promise<CallToolResult> => {
        try {
          return {
            content: [{ type: "text", text: JSON.stringify(await entry.handler(input, client)) ?? "null" }],
          };
        } catch (error) {
          return {
            isError: true,
            content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          };
        }
      }
    );
  }
  return server;
}
