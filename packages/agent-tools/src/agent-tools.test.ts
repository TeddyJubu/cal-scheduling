import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CalAccounts, clientFromEnv } from "./accounts.js";
import { apiVersions, CalClient } from "./client.js";
import { createMcpServer, MCP_SERVER_VERSION } from "./mcp.js";
import { getTools, toFunctionDefinitions, tools } from "./tools.js";

const client = new CalClient({ apiKey: "test-key", baseUrl: "https://cal.example/api/" });
function mockResponse(body: unknown = { status: "success", data: [] }, status = 200) {
  return vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => new Response(JSON.stringify(body), { status }))
  );
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
  it("includes the existing booking in rescheduling slot lookups", async () => {
    mockResponse();
    await run("get_available_slots", {
      eventTypeId: 1,
      start: "2030-01-01T00:00:00Z",
      end: "2030-01-02T00:00:00Z",
      bookingUidToReschedule: "uid/?",
    });
    expect(
      new URL(String(vi.mocked(fetch).mock.calls[0][0])).searchParams.get("bookingUidToReschedule")
    ).toBe("uid/?");
  });
  it("exports JSON schemas and filters all mutations", () => {
    expect(toFunctionDefinitions()).toHaveLength(19);
    expect(toFunctionDefinitions()[0].function.parameters.type).toBe("object");
    expect(getTools({ readOnly: true }).map((entry) => entry.name)).toEqual([
      "list_events",
      "get_event",
      "list_event_rsvps",
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
      expect(peer.getServerVersion()?.version).toBe(MCP_SERVER_VERSION);
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

describe("community events", () => {
  const event = {
    title: "Book club",
    startTime: "2030-01-01T18:00:00+01:00",
    endTime: "2030-01-01T20:00:00+01:00",
    timeZone: "Europe/Paris",
    capacity: null,
    hidden: true,
    showAttendees: false,
    category: "Books",
    description: null,
    location: "Cafe",
  };
  it.each([
    { name: "create_event", input: event, path: "", method: "POST", body: event },
    { name: "get_event", input: { eventUid: "uid/?" }, path: "/uid%2F%3F", method: "GET", body: undefined },
    {
      name: "update_event",
      input: { eventUid: "uid/?", capacity: 10, category: null },
      path: "/uid%2F%3F",
      method: "PATCH",
      body: { capacity: 10, category: null },
    },
    {
      name: "cancel_event",
      input: { eventUid: "uid/?" },
      path: "/uid%2F%3F/cancel",
      method: "POST",
      body: {},
    },
    {
      name: "rsvp_event",
      input: {
        eventUid: "uid/?",
        name: "Ada",
        email: "ada@example.com",
        status: "GOING",
        plusOnes: 2,
        note: null,
      },
      path: "/uid%2F%3F/rsvps",
      method: "POST",
      body: { name: "Ada", email: "ada@example.com", status: "GOING", plusOnes: 2, note: null },
    },
    {
      name: "list_event_rsvps",
      input: { eventUid: "uid/?" },
      path: "/uid%2F%3F/rsvps",
      method: "GET",
      body: undefined,
    },
    {
      name: "list_events",
      input: { period: "past", take: 100, skip: 2 },
      path: "?period=past&take=100&skip=2",
      method: "GET",
      body: undefined,
    },
  ])("maps $name", async ({ name, input, path, method, body }) => {
    mockResponse();
    await run(name, input);
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe(`https://cal.example/api/v2/community-events${path}`);
    expect(init?.method).toBe(method);
    expect(init?.headers).toMatchObject({ "cal-api-version": "2024-06-14" });
    expect(init?.body === undefined ? undefined : JSON.parse(String(init.body))).toEqual(body);
  });
  it.each([
    ["create_event", {}],
    ["create_event", { ...event, capacity: 0 }],
    ["list_events", { take: 101 }],
    ["rsvp_event", { eventUid: "x", name: "A", email: "a@example.com", status: "GOING", plusOnes: 11 }],
  ])("validates %s", (name, input) => {
    mockResponse();
    expect(() => run(String(name), input)).toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each([
    "create_event",
    "get_event",
  ])("adds publicUrl to %s without dropping response data", async (name) => {
    const response = {
      status: "success",
      data: { uid: "u", slug: "book club", host: { username: "a/b", name: "Ada" }, hidden: true },
    };
    mockResponse(response);
    const entry = tools.find((tool) => tool.name === name);
    const input = name === "create_event" ? event : { eventUid: "u" };
    const withWeb = new CalClient({ apiKey: "key", webUrl: "https://web.example/prefix/" });
    expect(await entry?.handler(input, withWeb)).toEqual({
      ...response,
      data: { ...response.data, publicUrl: "https://web.example/prefix/events/a%2Fb/book%20club" },
    });
    expect(await entry?.handler(input, client)).toEqual(response);
  });
  it("preserves empty/unlinkable responses and propagates full errors", async () => {
    const web = new CalClient({ apiKey: "key", webUrl: "https://web.example" });
    for (const value of [null, { data: [] }, { data: { slug: "x", host: { username: null } } }])
      expect(web.withPublicEventUrl(value)).toEqual(value);
    mockResponse({ error: "EVENT_FULL" }, 409);
    await expect(
      run("rsvp_event", { eventUid: "u", name: "A", email: "a@example.com", status: "GOING" })
    ).rejects.toThrow("409");
  });
});

describe("business accounts", () => {
  const config = {
    accounts: {
      bookclub: { apiKey: "book-key", apiUrl: "https://books.example", webUrl: "https://books-web.example" },
      cafe: { apiKey: "cafe-key", apiUrl: "https://cafe.example", webUrl: "https://cafe-web.example" },
    },
    defaultAccount: "cafe",
  };
  it("routes selected and default accounts without forwarding business", async () => {
    const accounts = new CalAccounts(config);
    const event = accounts.getTools().find((entry) => entry.name === "get_event");
    mockResponse({ data: { slug: "reading", host: { username: "host" } } });
    expect(await event?.handler({ eventUid: "u" })).toMatchObject({
      data: { publicUrl: "https://cafe-web.example/events/host/reading" },
    });
    expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer cafe-key" });
    expect(String(vi.mocked(fetch).mock.calls[0][0])).toBe("https://cafe.example/v2/community-events/u");
    await event?.handler({ eventUid: "u", business: "bookclub" });
    expect(vi.mocked(fetch).mock.calls[1][1]?.headers).toMatchObject({ Authorization: "Bearer book-key" });
    expect(String(vi.mocked(fetch).mock.calls[1][0])).toBe("https://books.example/v2/community-events/u");
    expect(() => event?.handler({ eventUid: "u", business: "missing" })).toThrow();
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("lists only names, exposes business enums and filters mutations", async () => {
    const accounts = new CalAccounts(config);
    const entries = accounts.getTools({ readOnly: true });
    expect(entries).toHaveLength(10);
    expect(entries.every((entry) => !entry.mutating)).toBe(true);
    expect(entries.every((entry) => entry.inputSchema.shape.business)).toBe(true);
    expect(await entries.find((entry) => entry.name === "list_businesses")?.handler({})).toEqual([
      "bookclub",
      "cafe",
    ]);
    const json = JSON.stringify(toFunctionDefinitions({ accounts }));
    expect(json).toContain('"enum":["bookclub","cafe"]');
    expect(json).not.toContain("book-key");
    expect(json).not.toContain("cafe-key");
    expect(getTools({ accounts })).toHaveLength(20);
  });
  it("defaults to first account and keeps single-account schemas unchanged", () => {
    expect(new CalAccounts({ accounts: config.accounts }).defaultAccount).toBe("bookclub");
    const single = new CalAccounts({ accounts: { cafe: config.accounts.cafe } });
    expect(single.getTools()).toHaveLength(19);
    expect(single.getTools().every((entry) => !entry.inputSchema.shape.business)).toBe(true);
    expect(clientFromEnv({ CAL_API_KEY: "key", CAL_WEB_URL: "https://web.example" })).toBeInstanceOf(
      CalClient
    );
    expect(
      clientFromEnv({ CAL_ACCOUNTS: JSON.stringify(config.accounts), CAL_DEFAULT_ACCOUNT: "cafe" })
    ).toBeInstanceOf(CalAccounts);
  });
  it("uses environment URL fallbacks without leaking business into write bodies", async () => {
    const accounts = clientFromEnv({
      CAL_ACCOUNTS: JSON.stringify({ one: { apiKey: "key" }, two: { apiKey: "other" } }),
      CAL_API_URL: "https://api.example",
      CAL_WEB_URL: "https://web.example",
    });
    if (!(accounts instanceof CalAccounts)) throw new Error("Expected accounts");
    mockResponse({ data: { slug: "books", host: { username: "host" } } });
    const result = await accounts
      .getTools()
      .find((entry) => entry.name === "create_event")
      ?.handler({
        business: "two",
        title: "Books",
        startTime: "2030-01-01T12:00:00Z",
        endTime: "2030-01-01T13:00:00Z",
        timeZone: "UTC",
      });
    expect(result).toMatchObject({ data: { publicUrl: "https://web.example/events/host/books" } });
    const [url, init] = vi.mocked(fetch).mock.calls[0];
    expect(String(url)).toBe("https://api.example/v2/community-events");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer other" });
    expect(String(init?.body)).not.toContain("business");
  });
  it.each([
    {},
    { CAL_ACCOUNTS: "{secret-key" },
    { CAL_ACCOUNTS: "{}" },
    { CAL_ACCOUNTS: '{"a":{"apiKey":"secret-key","apiUrl":"bad"}}' },
    { CAL_ACCOUNTS: JSON.stringify(config.accounts), CAL_DEFAULT_ACCOUNT: "unknown" },
  ])("rejects invalid config without exposing keys", (env) => {
    expect(() => clientFromEnv(env)).toThrow();
    try {
      clientFromEnv(env);
    } catch (error) {
      expect(String(error)).not.toContain("secret-key");
    }
  });
  it("selects businesses over MCP in read-only mode", async () => {
    const accounts = new CalAccounts(config);
    const server = createMcpServer(accounts, { readOnly: true });
    const peer = new Client({ name: "test", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(a);
    await peer.connect(b);
    try {
      expect((await peer.listTools()).tools).toHaveLength(10);
      mockResponse();
      await peer.callTool({ name: "get_me", arguments: { business: "bookclub" } });
      expect(vi.mocked(fetch).mock.calls[0][1]?.headers).toMatchObject({ Authorization: "Bearer book-key" });
      expect(await peer.callTool({ name: "create_event", arguments: {} })).toMatchObject({ isError: true });
    } finally {
      await peer.close();
      await server.close();
    }
  });
});
