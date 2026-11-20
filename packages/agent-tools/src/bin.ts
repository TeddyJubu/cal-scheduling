#!/usr/bin/env node
import { env } from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CalClient } from "./client.js";
import { createMcpServer } from "./mcp.js";

if (!env.CAL_API_KEY) throw new Error("CAL_API_KEY is required");
const client = new CalClient({ apiKey: env.CAL_API_KEY, baseUrl: env.CAL_API_URL });
await createMcpServer(client, { readOnly: env.CAL_MCP_READ_ONLY === "true" }).connect(
  new StdioServerTransport()
);
