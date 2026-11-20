import { toJsonSchemaCompat } from "@modelcontextprotocol/sdk/server/zod-json-schema-compat.js";
import { z } from "zod";
import type { CalAccounts } from "./accounts.js";
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
const seats = z.union([
  z.object({
    seatsPerTimeSlot: id.max(1000),
    showAttendeeInfo: z.boolean(),
    showAvailabilityCount: z.boolean(),
  }),
  z.object({ disabled: z.literal(true) }),
]);
const eventTypeFields = {
  title: text,
  slug: text,
  lengthInMinutes: id,
  description: z.string().optional(),
  seats: seats.optional(),
};
const eventUid = text.describe("Community event UID, not a booking or event-type ID");
const eventFields = {
  title: text,
  slug: text.optional(),
  startTime: z.string().datetime({ offset: true }),
  endTime: z.string().datetime({ offset: true }),
  timeZone,
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  coverImageUrl: z.string().url().nullable().optional(),
  location: z.string().nullable().optional(),
  capacity: id.nullable().optional(),
  hidden: z.boolean().optional(),
  showAttendees: z.boolean().optional(),
};

export const tools: AgentTool[] = [
  tool(
    "create_event",
    "Create a one-off community event after user confirmation. Use ISO-8601 startTime/endTime (with UTC Z or offset), an IANA timeZone, and optional free-text category. capacity null means unlimited. hidden means unlisted but reachable by link; showAttendees controls public first names. Returns publicUrl when a web URL and host username are available.",
    z.object(eventFields),
    async (body, c) => c.withPublicEventUrl(await c.request("community-events", { body })),
    true
  ),
  tool(
    "list_events",
    "List this account's community events, optionally upcoming or past. Paginate with take (1–100) and skip. Owner views include visibility flags and RSVP counts.",
    z.object({
      period: z.enum(["upcoming", "past"]).optional(),
      take: id.max(100).optional(),
      skip: z.number().int().min(0).optional(),
    }),
    (query, c) => c.request("community-events", { query })
  ),
  tool(
    "get_event",
    "Get an owned community event by UID, including visibility, attendance counts, and publicUrl when configured. Use before making changes.",
    z.object({ eventUid }),
    async ({ eventUid: uid }, c) =>
      c.withPublicEventUrl(await c.request("community-events", { path: `/${encodeURIComponent(uid)}` }))
  ),
  tool(
    "update_event",
    "Update an owned community event after confirmation. Only supplied fields change; ISO-8601 times include UTC Z or an offset. Set capacity to null for unlimited attendance.",
    z.object(eventFields).partial().extend({ eventUid }),
    ({ eventUid: uid, ...body }, c) =>
      c.request("community-events", { path: `/${encodeURIComponent(uid)}`, method: "PATCH", body }),
    true
  ),
  tool(
    "cancel_event",
    "Cancel an owned community event by UID after explicit user confirmation. Cancelled events cannot accept RSVPs.",
    z.object({ eventUid }),
    ({ eventUid: uid }, c) =>
      c.request("community-events", { path: `/${encodeURIComponent(uid)}/cancel`, method: "POST", body: {} }),
    true
  ),
  tool(
    "rsvp_event",
    "Add or update an RSVP on behalf of someone for an owned community event, after confirmation. Reusing their email updates the RSVP. GOING consumes 1 + plusOnes seats; full events return HTTP 409. Cancelled or ended events reject RSVPs.",
    z.object({
      eventUid,
      name: text,
      email: z.string().email(),
      status: z.enum(["GOING", "MAYBE", "NOT_GOING"]),
      plusOnes: z.number().int().min(0).max(10).optional(),
      note: z.string().nullable().optional(),
    }),
    ({ eventUid: uid, ...body }, c) =>
      c.request("community-events", { path: `/${encodeURIComponent(uid)}/rsvps`, body }),
    true
  ),
  tool(
    "list_event_rsvps",
    "List RSVPs for an owned community event, including emails and notes. Treat attendee details as private and share only with the event owner.",
    z.object({ eventUid }),
    ({ eventUid: uid }, c) => c.request("community-events", { path: `/${encodeURIComponent(uid)}/rsvps` })
  ),
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
    "Find available slots before booking or rescheduling. Provide eventTypeId OR eventTypeSlug plus username. start/end are ISO-8601 UTC timestamps; results default to UTC. Seated slots expose seatsBooked, seatsRemaining and seatsTotal. Each attendee books their own seat with create_booking at the same start time.",
    z.object({
      eventTypeId: id.optional(),
      eventTypeSlug: text.optional(),
      username: text.optional(),
      start: utc,
      end: utc,
      timeZone: timeZone.optional(),
      bookingUidToReschedule: bookingUid
        .optional()
        .describe("Existing booking UID when rescheduling, to include slots overlapping that booking"),
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
    "Create a booking after checking availability and confirming with the user. start must be ISO-8601 UTC ending in Z. attendee.timeZone is an IANA zone. For seated events, each attendee books their own seat using the same eventTypeId and start time; guests are not separate seat reservations. Store the returned UID for changes.",
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
    "add_booking_guests",
    "Add 1–10 guests to an existing booking after user confirmation (30 total maximum). Sends notifications; not a substitute for booking individual seats on seated events.",
    z.object({
      bookingUid,
      guests: z
        .array(z.object({ email: z.string().email(), name: text.optional(), timeZone: timeZone.optional() }))
        .min(1)
        .max(10),
    }),
    ({ bookingUid: uid, ...body }, c) =>
      c.request("bookings", { path: `/${encodeURIComponent(uid)}/guests`, body }),
    true
  ),
  tool(
    "create_event_type",
    "Create a bookable event type after user confirmation. Seated event types let many people book the same slot for workshops, classes or group sessions. Configure seatsPerTimeSlot, showAttendeeInfo and showAvailabilityCount in seats.",
    z.object(eventTypeFields),
    (body, c) => c.request("event-types", { body }),
    true
  ),
  tool(
    "update_event_type",
    "Update an event type after user confirmation. Only supplied fields change. Configure seats for group sessions, or pass seats: { disabled: true } to disable seats.",
    z.object({ ...z.object(eventTypeFields).partial().shape, eventTypeId: id }),
    ({ eventTypeId, ...body }, c) => {
      if (Object.keys(body).length === 0) throw new Error("Provide at least one event type field to update");
      return c.request("event-types", { path: `/${eventTypeId}`, method: "PATCH", body });
    },
    true
  ),
  tool(
    "list_schedules",
    "List the account's availability schedules and time zones. Use to understand working hours; use get_available_slots for actual bookable times.",
    z.object({}),
    (_, c) => c.request("schedules")
  ),
];

export function getTools(options: { readOnly?: boolean; accounts?: CalAccounts } = {}): AgentTool[] {
  if (options.accounts) return options.accounts.getTools({ readOnly: options.readOnly });
  return tools.filter((entry) => !options.readOnly || !entry.mutating);
}

export function toFunctionDefinitions(options: { readOnly?: boolean; accounts?: CalAccounts } = {}) {
  return getTools(options).map(({ name, description, inputSchema }) => ({
    type: "function" as const,
    function: { name, description, parameters: toJsonSchemaCompat(inputSchema, { strictUnions: true }) },
  }));
}

export type { AgentTool };
