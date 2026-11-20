# @teddyjubu/cal-agent-tools

Standalone scheduling tools for Cal.diy / Cal.com API v2. No Cal.com workspace
dependencies, database access, or framework required. Requires Node.js 22+.
Returns the API's JSON response unchanged (including `status`, `data` and any
pagination fields). API errors include the HTTP status and response message.

## Install

```sh
npm install @teddyjubu/cal-agent-tools
# Or run the MCP server without installing globally:
CAL_API_KEY=cal_live_... npx -y @teddyjubu/cal-agent-tools
```

For a source checkout: `yarn workspace @teddyjubu/cal-agent-tools build`, then
`node packages/agent-tools/dist/bin.js`.

## MCP configuration

Claude Desktop (`claude_desktop_config.json`) and Cursor (`.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "cal": {
      "command": "npx",
      "args": ["-y", "@teddyjubu/cal-agent-tools"],
      "env": {
        "CAL_API_KEY": "YOUR_API_KEY",
        "CAL_API_URL": "https://your-cal-api.example.com",
        "CAL_MCP_READ_ONLY": "true"
      }
    }
  }
}
```

Generic stdio MCP clients may instead launch a local build:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/packages/agent-tools/dist/bin.js"],
  "env": { "CAL_API_KEY": "YOUR_API_KEY" }
}
```

| Environment variable | Meaning |
| --- | --- |
| `CAL_API_KEY` | Required Bearer API key. Create in Settings → Developer → API Keys. |
| `CAL_API_URL` | Optional API origin/prefix; defaults to `https://api.cal.com`. Do **not** append `/v2`; it is added automatically. |
| `CAL_MCP_READ_ONLY` | Exactly `true` omits create, reschedule and cancel tools. Default: mutations enabled. |

Only use trusted API URLs (the key is sent to that URL). Use HTTPS outside local
development. Keep keys out of source control and prompts. The server uses stdio;
stdout is reserved for MCP protocol messages. Read-only mode reduces exposed
tools, but is not a replacement for server-side API-key permissions.

## Library: OpenAI-style function calling

Install your chosen provider SDK separately. Definitions are plain JSON Schema;
tool handlers accept unknown input and validate with Zod before any HTTP call.

```ts
import { CalClient, getTools, toFunctionDefinitions } from "@teddyjubu/cal-agent-tools";

const client = new CalClient({
  apiKey: process.env.CAL_API_KEY!,
  baseUrl: "https://your-cal-api.example.com", // optional
});
const tools = toFunctionDefinitions({ readOnly: true });
// Pass `tools` to OpenAI chat.completions.create({ model, messages, tools }).
// For each returned function tool call:
async function execute(call: { function: { name: string; arguments: string } }) {
  const definition = getTools({ readOnly: true }).find(t => t.name === call.function.name);
  if (!definition) throw new Error("Unknown or disabled tool");
  const result = await definition.handler(JSON.parse(call.function.arguments), client);
  return JSON.stringify(result); // send as the tool-result content, with its tool_call_id
}
```

For Anthropic, map each function definition to
`{ name: f.name, description: f.description, input_schema: f.parameters }`.
Errors throw; your framework should return an appropriate tool error to the model.
Require explicit user confirmation in the host application before mutations.

## Library: Vercel AI SDK

With the separately installed `ai` SDK (v5+):

```ts
import { jsonSchema, tool } from "ai";
import { CalClient, getTools, toFunctionDefinitions } from "@teddyjubu/cal-agent-tools";

const client = new CalClient({ apiKey: process.env.CAL_API_KEY! });
const definitions = toFunctionDefinitions({ readOnly: true });
const calTools = Object.fromEntries(getTools({ readOnly: true }).map((entry, i) => [
  entry.name,
  tool({
    description: entry.description,
    inputSchema: jsonSchema(definitions[i].function.parameters),
    execute: input => entry.handler(input, client),
  }),
]));
// Pass calTools to generateText({ model, prompt, tools: calTools }).
```

`createMcpServer(client, { readOnly: true })` is also exported for custom MCP
transports; the CLI wires it to stdio.

## Tools

| Tool | Purpose |
| --- | --- |
| `get_me` | Identify the authenticated account. |
| `list_event_types` | Discover event type IDs; optional username. |
| `get_available_slots` | Query by eventTypeId or eventTypeSlug + username, start/end, optional timeZone. |
| `create_booking` | Book eventTypeId at start with attendee name/email/timeZone; optional notes, guests, metadata. |
| `list_bookings` | Optional status, attendeeEmail, take (1–250), skip filters. |
| `get_booking` | Retrieve by bookingUid (not numeric ID). |
| `reschedule_booking` | Move bookingUid to start, optional reschedulingReason. |
| `cancel_booking` | Cancel bookingUid with optional reason. |
| `list_schedules` | Retrieve working-hour schedules. |

All start/end inputs are ISO-8601 UTC timestamps ending in `Z`; timeZone values
are IANA names. Check slots before creating/rescheduling. Notes map to API v2
`bookingFieldsResponses.notes`; cancellation reason maps to `cancellationReason`.
Metadata accepts up to 50 string entries (keys ≤40, values ≤500 characters).
These minimal tools do not cover special event requirements such as custom
required booking fields, SMS verification, seats, or recurring-booking controls;
the API may reject such bookings with an explanatory error.

Endpoint versions: bookings `2024-08-13`, slots `2024-09-04`, event-types
`2024-06-14`, schedules `2024-06-11`. Self-hosted instances must expose these
API v2 versions. Tests: `yarn workspace @teddyjubu/cal-agent-tools test`.
