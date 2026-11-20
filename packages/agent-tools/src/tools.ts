import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { z } from "zod";
import type { CalClient } from "./client.js";

interface AgentTool {
  name: string;
  description: string;
  inputSchema: z.AnyZodObject;
  mutating: boolean;
  handler: (input: unknown, client: CalClient) => Promise<unknown>;
}

function tool<S extends z.AnyZodObject>(
  name: string,
  description: string,
  inputSchema: S,
  handler: (input: z.infer<S>, client: CalClient) => Promise<unknown>,
  mutating = false
): AgentTool {
  return {
    name,
    description,
    inputSchema,
    mutating,
    handler: (input, client) => handler(inputSchema.parse(input), client),
  };
}

const id = z.number().int().positive();
const text = z.string().min(1);
const utc = z.string().datetime().describe("ISO-8601 UTC timestamp ending in Z");
const timeZone = text.describe("IANA time zone, e.g. America/New_York or UTC");
const bookingUid = text.describe("Booking UID, not the numeric booking ID");

export const tools: AgentTool[] = [
  tool(
    "get_me",
    "Get the authenticated user's profile. Use to identify the account before scheduling.",
    z.object({}),
    (_, c) => c.request("me")
  ),
  tool(
    "list_event_types",
    "List bookable event types and their IDs. Use before looking up slots or creating a booking; omit username for your account.",
    z.object({ username: text.optional() }),
    (query, c) => c.request("event-types", { query })
  ),
  tool(
    "get_available_slots",
    "Find available slots before booking or rescheduling. Provide eventTypeId OR eventTypeSlug plus username. start/end are ISO-8601 UTC timestamps; results default to UTC.",
    z.object({
      eventTypeId: id.optional(),
      eventTypeSlug: text.optional(),
      username: text.optional(),
      start: utc,
      end: utc,
      timeZone: timeZone.optional(),
    }),
    (query, c) => {
      if (!query.eventTypeId && !(query.eventTypeSlug && query.username))
        throw new Error("Provide eventTypeId or eventTypeSlug and username");
      if (Date.parse(query.start) >= Date.parse(query.end)) throw new Error("end must be after start");
      return c.request("slots", { query });
    }
  ),
  tool(
    "create_booking",
    "Create a booking after checking availability and confirming with the user. start must be ISO-8601 UTC ending in Z. attendee.timeZone is an IANA zone. Store the returned UID for changes.",
    z.object({
      eventTypeId: id,
      start: utc,
      attendee: z.object({ name: text, email: z.string().email(), timeZone }),
      notes: z.string().optional(),
      guests: z.array(z.string().email()).optional(),
      metadata: z
        .record(z.string().max(40), z.string().max(500))
        .refine((v) => Object.keys(v).length <= 50, "At most 50 metadata keys")
        .optional(),
    }),
    ({ notes, ...body }, c) =>
      c.request("bookings", {
        body: {
          ...body,
          ...(notes === undefined ? {} : { bookingFieldsResponses: { notes } }),
        },
      }),
    true
  ),
  tool(
    "list_bookings",
    "List bookings for this account. Filter by status or attendee email; use take/skip for pagination. Dates in responses are ISO-8601.",
    z.object({
      status: z.enum(["upcoming", "recurring", "past", "cancelled", "unconfirmed"]).optional(),
      attendeeEmail: z.string().email().optional(),
      take: z.number().int().min(1).max(250).optional(),
      skip: z.number().int().min(0).optional(),
    }),
    (query, c) => c.request("bookings", { query })
  ),
  tool(
    "get_booking",
    "Get booking details using its UID. Use before modifying a booking to verify the correct meeting.",
    z.object({ bookingUid }),
    ({ bookingUid: uid }, c) => c.request("bookings", { path: `/${encodeURIComponent(uid)}` })
  ),
  tool(
    "reschedule_booking",
    "Move a booking to an available slot after user confirmation. start must be ISO-8601 UTC ending in Z; check available slots first.",
    z.object({ bookingUid, start: utc, reschedulingReason: z.string().optional() }),
    ({ bookingUid: uid, ...body }, c) =>
      c.request("bookings", { path: `/${encodeURIComponent(uid)}/reschedule`, body }),
    true
  ),
  tool(
    "cancel_booking",
    "Cancel a booking by UID only after user confirmation. Optionally provide a human-readable reason.",
    z.object({ bookingUid, reason: z.string().optional() }),
    ({ bookingUid: uid, reason }, c) =>
      c.request("bookings", {
        path: `/${encodeURIComponent(uid)}/cancel`,
        body: { cancellationReason: reason },
      }),
    true
  ),
  tool(
    "list_schedules",
    "List the account's availability schedules and time zones. Use to understand working hours; use get_available_slots for actual bookable times.",
    z.object({}),
    (_, c) => c.request("schedules")
  ),
];

export function getTools(options: { readOnly?: boolean } = {}): AgentTool[] {
  return tools.filter((entry) => !options.readOnly || !entry.mutating);
}

export function toFunctionDefinitions(options: { readOnly?: boolean } = {}) {
  return getTools(options).map(({ name, description, inputSchema }) => ({
    type: "function" as const,
    function: { name, description, parameters: toJsonSchemaCompat(inputSchema, { strictUnions: true }) },
  }));
}

export type { AgentTool };
