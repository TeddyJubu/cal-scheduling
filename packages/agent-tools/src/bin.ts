#!/usr/bin/env node
import { env } from "node:process";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { clientFromEnv } from "./accounts.js";
import { createMcpServer } from "./mcp.js";

const client = clientFromEnv(env);
await createMcpServer(client, { readOnly: env.CAL_MCP_READ_ONLY === "true" }).connect(
  new StdioServerTransport()
);
