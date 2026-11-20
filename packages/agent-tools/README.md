# @teddyjubu/cal-agent-tools

Standalone scheduling tools for Cal.diy / Cal.com API v2. No Cal.com workspace
dependencies, database access, or framework required. Requires Node.js 22+.
Preserves API JSON envelopes (`status`, `data` and pagination fields). Community
event create/get results add `data.publicUrl` when a web URL and host username
are available. API errors include the HTTP status and response message.

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
| `CAL_API_KEY` | Bearer API key; required unless using `CAL_ACCOUNTS`. Create in Settings → Developer → API Keys. |
| `CAL_API_URL` | Optional API origin/prefix; defaults to `https://api.cal.com`. Do **not** append `/v2`; it is added automatically. |
| `CAL_WEB_URL` | Optional web app origin/prefix, e.g. `https://cal.example.com`. Adds public event links to create/get responses. |
| `CAL_ACCOUNTS` | Optional JSON object mapping business names to `{apiKey, apiUrl?, webUrl?}`. Takes precedence over `CAL_API_KEY`. |
| `CAL_DEFAULT_ACCOUNT` | Optional name from `CAL_ACCOUNTS`; defaults to the first account. Unknown names fail at startup. |
| `CAL_MCP_READ_ONLY` | Exactly `true` hides all writes: 9 read tools instead of 19 total (10/20 with multiple accounts). Default: mutations enabled. |

Only use trusted API URLs (the key is sent to that URL). Use HTTPS outside local
development. Keep keys out of source control and prompts. The server uses stdio;
stdout is reserved for MCP protocol messages. Read-only mode reduces exposed
tools, but is not a replacement for server-side API-key permissions.

## Multiple businesses (0.3.0)

Set the following environment entries in your MCP client's `env` configuration:

```json
{
  "CAL_ACCOUNTS": "{\"bookclub\":{\"apiKey\":\"BOOKCLUB_KEY\",\"apiUrl\":\"https://api.books.example\",\"webUrl\":\"https://books.example\"},\"cafe\":{\"apiKey\":\"CAFE_KEY\",\"apiUrl\":\"https://api.cafe.example\",\"webUrl\":\"https://cafe.example\"}}",
  "CAL_DEFAULT_ACCOUNT": "bookclub"
}
```

With more than one account, every tool has an optional `business` parameter whose
enum contains the configured names. Omit it to use the default/first account.
`list_businesses` returns only account names, never credentials or configuration.
The chosen account's API key, API URL and web URL are used together; `business` is
never sent to the API. Per-account `apiUrl`/`webUrl` override `CAL_API_URL`/
`CAL_WEB_URL`; absent API URLs default to `https://api.cal.com`. A single configured
account keeps the original schemas and omits `list_businesses`. Invalid or empty
account configuration fails before the server starts.

Library equivalent (no environment variables required):

```ts
import { CalAccounts, createMcpServer, toFunctionDefinitions } from "@teddyjubu/cal-agent-tools";

const accounts = new CalAccounts({
  accounts: {
    bookclub: { apiKey: "BOOKCLUB_KEY", apiUrl: "https://api.books.example", webUrl: "https://books.example" },
    cafe: { apiKey: "CAFE_KEY", apiUrl: "https://api.cafe.example" },
  },
  defaultAccount: "bookclub",
});
const definitions = toFunctionDefinitions({ accounts, readOnly: true });
const eventTool = accounts.getTools({ readOnly: true }).find(t => t.name === "get_event")!;
const result = await eventTool.handler({ eventUid: "EVENT_UID", business: "cafe" });
// Bound handlers need no client argument. For custom MCP transports:
const server = createMcpServer(accounts, { readOnly: true });
```

`clientFromEnv(process.env)` also exposes the CLI configuration parser. Existing
`CalClient`, `getTools()` and `createMcpServer(client)` usage remains supported.
For a single programmatic client, pass `webUrl` alongside `apiKey` and `baseUrl`.

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
| `add_booking_guests` | Add 1–10 guests (email, optional name/timeZone) to an existing bookingUid. |
| `create_event_type` | Create title, slug, lengthInMinutes, optional description and seats configuration. |
| `update_event_type` | Update those fields by eventTypeId; disable seats with `seats: { disabled: true }`. |
| `create_event` | Create a one-off community event; optional visibility and capacity settings. |
| `list_events` | List owned events with optional period (upcoming/past), take (1–100), skip. |
| `get_event` | Owner view by eventUid, with counts and visibility flags. |
| `update_event` | PATCH supplied event fields by eventUid. |
| `cancel_event` | Cancel an owned event after confirmation. |
| `rsvp_event` | Owner adds/updates name, email, status (GOING/MAYBE/NOT_GOING), optional plusOnes (0–10) and note. |
| `list_event_rsvps` | Owner-only RSVP list including private emails and notes. |
| `list_businesses` | Names only; available when multiple accounts are configured. |

## Community events

Community events are one-off public RSVP pages, distinct from bookable event types.
They require the Community Events API endpoints on your self-hosted instance.
`create_event` requires `title`, ISO-8601 `startTime`/`endTime` (UTC Z or an explicit
offset), and IANA `timeZone`. Optional fields: `slug`, `description`, free-text
`category`, `coverImageUrl`, `location`, `capacity`, `hidden`, `showAttendees`.
Nullable text fields and `capacity: null` are supported; null capacity means
unlimited. Hidden events remain reachable by direct link. `showAttendees` controls
public first names, not the private owner RSVP list. Updates accept the same fields.

Set `CAL_WEB_URL` (or an account's `webUrl`) for `create_event` and `get_event` to
include `data.publicUrl`: `<webUrl>/events/<username>/<slug>`. No URL is fabricated
for a host without a username. Other API response fields remain intact.
RSVPs use `eventUid` and email as the update identity. GOING consumes one seat plus
`plusOnes`; a full event returns HTTP 409, and cancelled/ended events reject RSVPs.
Event creation, updates, cancellation and RSVPs are writes and hidden in read-only
mode. Confirm them with the user first; owner RSVP results contain personal data.

## Group bookings

For workshops, classes and group sessions, use `create_event_type` with, for example,
`seats: { seatsPerTimeSlot: 10, showAttendeeInfo: false, showAvailabilityCount: true }`.
All three seat configuration fields are required; capacity must be 1–1000.
Use `get_available_slots` to check `seatsBooked`, `seatsRemaining` and `seatsTotal`.
Each attendee reserves their own seat with `create_booking` using the same eventTypeId
and start time. Adding guests does not replace individual seat reservations.

For extra guests on an existing booking, use `add_booking_guests` with its bookingUid
and `guests: [{ email: "guest@example.com", name: "Guest", timeZone: "UTC" }]`.
The API permits up to 10 guests per request and 30 total, and sends notifications.
Use `update_event_type` to change seat settings or pass `seats: { disabled: true }`
to turn seats off. These three tools are mutating and omitted in read-only mode.
Confirm changes with the user first.

All start/end inputs are ISO-8601 UTC timestamps ending in `Z`; timeZone values
are IANA names. Check slots before creating/rescheduling. Notes map to API v2
`bookingFieldsResponses.notes`; cancellation reason maps to `cancellationReason`.
Metadata accepts up to 50 string entries (keys ≤40, values ≤500 characters).
These minimal tools do not cover special event requirements such as custom
required booking fields, SMS verification, seat-specific cancellation, or recurring-booking controls;
the API may reject such bookings with an explanatory error.

Endpoint versions: bookings `2024-08-13`, slots `2024-09-04`, event-types
`2024-06-14`, schedules `2024-06-11`, community-events `2024-06-14` (accepted by
the controller's `API_VERSIONS_VALUES`). Self-hosted instances must expose these
API v2 versions. Tests: `yarn workspace @teddyjubu/cal-agent-tools test`.
