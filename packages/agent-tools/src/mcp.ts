import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { CalAccounts } from "./accounts.js";
import type { CalClient } from "./client.js";
import { getTools } from "./tools.js";

export function createMcpServer(client: CalClient | CalAccounts, options: { readOnly?: boolean } = {}) {
  const server = new McpServer({ name: "cal-mcp", version: "0.3.0" });
  const accounts = client instanceof CalAccounts ? client : undefined;
  const fallback = client instanceof CalAccounts ? client.client() : client;
  for (const entry of getTools({ ...options, accounts })) {
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
            content: [{ type: "text", text: JSON.stringify(await entry.handler(input, fallback)) ?? "null" }],
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
