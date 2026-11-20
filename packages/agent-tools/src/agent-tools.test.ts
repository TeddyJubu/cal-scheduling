import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { apiVersions, CalClient } from "./client.js";
import { createMcpServer } from "./mcp.js";
import { getTools, toFunctionDefinitions, tools } from "./tools.js";

const client = new CalClient({ apiKey: "test-key", baseUrl: "https://cal.example/api/" });
function mockResponse(body: unknown = { status: "success", data: [] }, status = 200) {
  return vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}
function run(name: string, input: unknown = {}) {
  const entry = tools.find((item) => item.name === name);
  if (!entry) throw new Error(`Unknown tool ${name}`);
  return entry.handler(input, client);
}
afterEach(() => vi.unstubAllGlobals());

describe("HTTP client", () => {
  it.each(Object.entries(apiVersions))("sets version and auth for %s", async (resource, version) => {
    mockResponse();
    await client.request(resource as keyof typeof apiVersions, {
      query: { email: "a+b@example.com", skip: 0, omitted: undefined },
    });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`https://cal.example/api/v2/${resource}?email=a%2Bb%40example.com&skip=0`);
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-key", "cal-api-version": version });
    expect(init?.method).toBe("GET");
  });
  it("defaults to hosted API and preserves response envelopes", async () => {
    mockResponse();
    expect(await new CalClient({ apiKey: "x" }).request("me")).toEqual({ status: "success", data: [] });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://api.cal.com/v2/me");
  });
  it.each([
    { error: { message: "Not authorized" } },
    "Proxy unavailable",
  ])("includes status and API error %j", async (body) => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 403 })
        )
    );
    await expect(client.request("me")).rejects.toThrow(
      `Cal API 403: ${typeof body === "string" ? body : JSON.stringify(body)}`
    );
  });
  it("handles empty success and network failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(new Response(null, { status: 204 }))
        .mockRejectedValueOnce(new Error("offline"))
    );
    expect(await client.request("me")).toBeNull();
    await expect(client.request("me")).rejects.toThrow("offline");
  });
});

describe("tools", () => {
  it("maps booking notes and optional fields to the v2 body", async () => {
    mockResponse();
    const body = {
      eventTypeId: 1,
      start: "2030-01-01T12:00:00Z",
      attendee: { name: "Ada", email: "ada@example.com", timeZone: "UTC" },
      guests: ["bob@example.com"],
      metadata: { source: "agent" },
    };
    await run("create_booking", { ...body, notes: "Discuss plans" });
    expect(vi.mocked(fetch).mock.calls[0][1]).toMatchObject({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...body, bookingFieldsResponses: { notes: "Discuss plans" } }),
    });
  });
  it("queries slots by slug and validates missing identifiers and range", async () => {
    mockResponse();
    const range = { start: "2030-01-01T00:00:00Z", end: "2030-01-02T00:00:00Z" };
    await run("get_available_slots", { ...range, eventTypeSlug: "intro", username: "ada", timeZone: "UTC" });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("eventTypeSlug=intro&username=ada&start=");
    expect(() => run("get_available_slots", range)).toThrow("Provide eventTypeId");
    expect(() => run("get_available_slots", { ...range, eventTypeId: 1, end: range.start })).toThrow(
      "end must be after start"
    );
    expect(() => run("create_booking", {})).toThrow();
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
  });
  it("encodes booking UIDs and maps cancellation reason", async () => {
    mockResponse();
    await run("cancel_booking", { bookingUid: "uid/?", reason: "Changed plans" });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toContain("/bookings/uid%2F%3F/cancel");
    expect(vi.mocked(fetch).mock.calls[0][1]?.body).toBe('{"cancellationReason":"Changed plans"}');
  });
  it("exports JSON schemas and filters all mutations", () => {
    expect(toFunctionDefinitions()).toHaveLength(12);
    expect(toFunctionDefinitions()[0].function.parameters.type).toBe("object");
    expect(getTools({ readOnly: true }).map((entry) => entry.name)).toEqual([
      "get_me",
      "list_event_types",
      "get_available_slots",
      "list_bookings",
      "get_booking",
      "list_schedules",
    ]);
  });
  it.each([
    {
      name: "add_booking_guests",
      input: { bookingUid: "uid/?", guests: [{ email: "ada@example.com", name: "Ada", timeZone: "UTC" }] },
      path: "bookings/uid%2F%3F/guests",
      method: "POST",
      version: "2024-08-13",
      body: { guests: [{ email: "ada@example.com", name: "Ada", timeZone: "UTC" }] },
    },
    {
      name: "create_event_type",
      input: {
        title: "Workshop",
        slug: "workshop",
        lengthInMinutes: 60,
        description: "Learn together",
        seats: { seatsPerTimeSlot: 10, showAttendeeInfo: false, showAvailabilityCount: true },
      },
      path: "event-types",
      method: "POST",
      version: "2024-06-14",
    },
    {
      name: "update_event_type",
      input: {
        eventTypeId: 42,
        title: "Class",
        slug: "class",
        lengthInMinutes: 30,
        description: "New class",
        seats: { seatsPerTimeSlot: 20, showAttendeeInfo: true, showAvailabilityCount: false },
      },
      path: "event-types/42",
      method: "PATCH",
      version: "2024-06-14",
      body: {
        title: "Class",
        slug: "class",
        lengthInMinutes: 30,
        description: "New class",
        seats: { seatsPerTimeSlot: 20, showAttendeeInfo: true, showAvailabilityCount: false },
      },
    },
    {
      name: "update_event_type",
      input: { eventTypeId: 42, seats: { disabled: true } },
      path: "event-types/42",
      method: "PATCH",
      version: "2024-06-14",
      body: { seats: { disabled: true } },
    },
    {
      name: "create_event_type",
      input: { title: "Intro", slug: "intro", lengthInMinutes: 15 },
      path: "event-types",
      method: "POST",
      version: "2024-06-14",
    },
    {
      name: "add_booking_guests",
      input: { bookingUid: "uid", guests: [{ email: "ada@example.com" }] },
      path: "bookings/uid/guests",
      method: "POST",
      version: "2024-08-13",
      body: { guests: [{ email: "ada@example.com" }] },
    },
  ])("maps $name to $method $path", async ({ name, input, path, method, version, body }) => {
    mockResponse();
    await run(name, input);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`https://cal.example/api/v2/${path}`);
    expect(init).toMatchObject({
      method,
      headers: { "cal-api-version": version, "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(init?.body))).toEqual(body ?? input);
  });
  it.each([
    ["add_booking_guests", { bookingUid: "uid", guests: [] }],
    ["add_booking_guests", { bookingUid: "uid", guests: [{ email: "invalid" }] }],
    [
      "add_booking_guests",
      { bookingUid: "uid", guests: Array.from({ length: 11 }, () => ({ email: "ada@example.com" })) },
    ],
    ["create_event_type", {}],
    ["create_event_type", { title: "Class", slug: "class", lengthInMinutes: 0 }],
    ["update_event_type", { eventTypeId: 42 }],
    ["update_event_type", { eventTypeId: 42, seats: { disabled: false } }],
    [
      "update_event_type",
      {
        eventTypeId: 42,
        seats: { seatsPerTimeSlot: 1001, showAttendeeInfo: true, showAvailabilityCount: true },
      },
    ],
  ])("rejects invalid %s input before fetching", (name, input) => {
    mockResponse();
    expect(() => run(String(name), input)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    ["add_booking_guests", { bookingUid: "uid", guests: [{ email: "ada@example.com" }] }],
    ["create_event_type", { title: "Class", slug: "class", lengthInMinutes: 30 }],
    ["update_event_type", { eventTypeId: 42, seats: { disabled: true } }],
  ])("propagates API errors from %s", async (name, input) => {
    mockResponse({ error: { message: "Forbidden" } }, 403);
    await expect(run(String(name), input)).rejects.toThrow('Cal API 403: {"error":{"message":"Forbidden"}}');
  });
  it("registers only read tools over MCP and reports handler errors", async () => {
    const server = createMcpServer(client, { readOnly: true });
    const peer = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await peer.connect(b);
    try {
      expect((await peer.listTools()).tools.map((entry) => entry.name)).toEqual(
        getTools({ readOnly: true }).map((entry) => entry.name)
      );
      mockResponse({ error: { message: "Forbidden" } }, 403);
      expect(await peer.callTool({ name: "get_me", arguments: {} })).toMatchObject({
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("403") }],
      });
      mockResponse();
      expect(await peer.callTool({ name: "get_me", arguments: {} })).toMatchObject({
        content: [{ type: "text", text: '{"status":"success","data":[]}' }],
      });
    } finally {
      await peer.close();
      await server.close();
    }
  });
});
