import { ErrorCode } from "@calcom/lib/errorCodes";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { mockDeep, mockReset } from "vitest-mock-extended";
import type { CommunityEventRepository, EventRecord } from "./CommunityEventRepository";
import { CommunityEventService } from "./CommunityEventService";

const repository = mockDeep<CommunityEventRepository>();
const service = new CommunityEventService(repository);
const input = {
  title: "Café Book Club!",
  startTime: new Date("2099-01-01T18:00:00Z"),
  endTime: new Date("2099-01-01T20:00:00Z"),
  timeZone: "UTC",
};
const event: EventRecord = {
  ...input,
  id: 1,
  uid: "event",
  userId: 2,
  slug: "cafe-book-club",
  description: null,
  category: null,
  coverImageUrl: null,
  location: null,
  capacity: 4,
  hidden: false,
  showAttendees: true,
  status: "SCHEDULED",
  user: { name: "Host", username: "host" },
};
const rsvp = {
  uid: "rsvp",
  name: "Ada Lovelace",
  email: "ada@example.com",
  status: "GOING" as const,
  plusOnes: 1,
  note: "Private note",
  createdAt: new Date(),
  updatedAt: new Date(),
};
const groups = (people: number, plusOnes: number) => [
  { status: "GOING" as const, _count: { _all: people }, _sum: { plusOnes } },
];

beforeEach(() => {
  mockReset(repository);
  repository.withEventLock.mockImplementation(async (_, operation) => operation(repository));
  repository.findByUid.mockResolvedValue(event);
  repository.findByUserAndSlug.mockResolvedValue(event);
  repository.create.mockResolvedValue(event);
  repository.update.mockResolvedValue(event);
  repository.listRsvps.mockResolvedValue([rsvp]);
  repository.aggregateCounts.mockResolvedValue(groups(1, 0));
  repository.upsertRsvp.mockResolvedValue(rsvp);
});

describe("CommunityEventService", () => {
  it("generates a slug and returns a DTO", async () => {
    expect(await service.createEvent(2, input)).toMatchObject({
      slug: "cafe-book-club",
      startTime: input.startTime.toISOString(),
    });
    expect(repository.create).toHaveBeenCalledWith({ ...input, userId: 2, slug: "cafe-book-club" });
  });
  it.each([
    { endTime: input.startTime },
    { endTime: new Date("2000-01-01") },
    { capacity: 0 },
    { capacity: 1.5 },
    { title: "" },
    { startTime: new Date("invalid") },
    { timeZone: "invalid" },
  ])("rejects invalid event %j", async (override) => {
    await expect(service.createEvent(2, { ...input, ...override })).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
    expect(repository.create).not.toHaveBeenCalled();
  });
  it("translates slug conflicts including update races", async () => {
    vi.mocked(repository.create).mockRejectedValue({ code: "P2002" });
    vi.mocked(repository.update).mockRejectedValue({ code: "P2002" });
    await expect(service.createEvent(2, input)).rejects.toThrow("slug already exists");
    await expect(service.updateEvent(2, "event", { slug: "taken" })).rejects.toThrow("slug already exists");
  });
  it("validates merged update times and preserves owner control", async () => {
    await expect(
      service.updateEvent(2, "event", { startTime: new Date("2100-01-01") })
    ).rejects.toMatchObject({ code: ErrorCode.BadRequest });
    await service.updateEvent(2, "event", { title: "New title" });
    expect(repository.update).toHaveBeenCalledWith("event", { title: "New title" });
    await service.cancelEvent(2, "event");
    expect(repository.update).toHaveBeenCalledWith("event", { status: "CANCELLED" });
    expect(await service.listRsvps(2, "event")).toMatchObject([{ email: rsvp.email }]);
  });
  it("rejects non-owners and missing events", async () => {
    await expect(service.updateEvent(3, "event", {})).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    await expect(service.cancelEvent(3, "event")).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    await expect(service.listRsvps(3, "event")).rejects.toMatchObject({ code: ErrorCode.Forbidden });
    vi.mocked(repository.findByUid).mockResolvedValue(null);
    vi.mocked(repository.findByUserAndSlug).mockResolvedValue(null);
    await expect(service.getPublicEventByUid("missing")).rejects.toMatchObject({ code: ErrorCode.NotFound });
    await expect(service.getPublicEvent("host", "missing")).rejects.toMatchObject({
      code: ErrorCode.NotFound,
    });
  });
  it("normalizes email and excludes the existing RSVP when replacing its headcount", async () => {
    vi.mocked(repository.aggregateCounts).mockResolvedValue(groups(1, 1));
    await service.rsvp("event", {
      name: rsvp.name,
      email: " ADA@EXAMPLE.COM ",
      status: "GOING",
      plusOnes: 1,
    });
    expect(repository.aggregateCounts).toHaveBeenCalledWith(1, rsvp.email);
    expect(repository.upsertRsvp).toHaveBeenCalledWith(1, {
      name: rsvp.name,
      email: rsvp.email,
      status: "GOING",
      plusOnes: 1,
    });
  });
  it("rejects full events including plus ones", async () => {
    vi.mocked(repository.aggregateCounts).mockResolvedValue(groups(2, 1));
    await expect(service.rsvp("event", { ...rsvp })).rejects.toMatchObject({ code: "EVENT_FULL" });
    expect(repository.upsertRsvp).not.toHaveBeenCalled();
  });
  it.each(["MAYBE", "NOT_GOING"] as const)("allows %s on full events", async (status) => {
    await service.rsvp("event", { ...rsvp, status });
    expect(repository.aggregateCounts).not.toHaveBeenCalled();
  });
  it("supports unlimited capacity and default plus ones", async () => {
    vi.mocked(repository.findByUid).mockResolvedValue({ ...event, capacity: null });
    await service.rsvp("event", { name: "Ada", email: rsvp.email, status: "GOING" });
    expect(repository.upsertRsvp).toHaveBeenCalledWith(1, expect.objectContaining({ plusOnes: 0 }));
    expect(repository.aggregateCounts).not.toHaveBeenCalled();
  });
  it.each([
    { status: "CANCELLED" as const },
    { endTime: new Date("2000-01-01") },
  ])("rejects closed events %j", async (override) => {
    vi.mocked(repository.findByUid).mockResolvedValue({ ...event, ...override });
    await expect(service.rsvp("event", rsvp)).rejects.toMatchObject({ code: ErrorCode.BadRequest });
  });
  it.each([-1, 11, 1.5])("rejects invalid plusOnes %s", async (plusOnes) => {
    await expect(service.rsvp("event", { ...rsvp, plusOnes })).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
  });
  it("exposes first names of GOING RSVPs only, never emails or notes", async () => {
    vi.mocked(repository.listRsvps).mockResolvedValue([
      rsvp,
      { ...rsvp, name: "Maybe Person", status: "MAYBE" },
    ]);
    const result = await service.getPublicEvent("host", "cafe-book-club");
    expect(result).toMatchObject({ goingCount: 2, maybeCount: 1, spotsLeft: 2, attendees: ["Ada"] });
    expect(JSON.stringify(result)).not.toMatch(/email|example.com|Lovelace|Private note/);
    vi.mocked(repository.findByUid).mockResolvedValue({ ...event, showAttendees: false, hidden: true });
    expect(await service.getPublicEventByUid("event")).toMatchObject({ attendees: [], goingCount: 2 });
  });
  it("handles empty RSVPs and unlimited spots", async () => {
    vi.mocked(repository.findByUid).mockResolvedValue({ ...event, capacity: null });
    vi.mocked(repository.listRsvps).mockResolvedValue([]);
    expect(await service.getPublicEventByUid("event")).toMatchObject({
      goingCount: 0,
      maybeCount: 0,
      spotsLeft: null,
      attendees: [],
    });
  });
  it("ignores undefined updates and rejects capacity below the full headcount", async () => {
    await service.updateEvent(2, "event", { startTime: undefined, title: "Changed" });
    expect(repository.update).toHaveBeenCalledWith("event", { title: "Changed" });
    repository.aggregateCounts.mockResolvedValue(groups(1, 2));
    await expect(service.updateEvent(2, "event", { capacity: 2 })).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
    await service.updateEvent(2, "event", { capacity: 3 });
    await service.updateEvent(2, "event", { capacity: null });
  });
  it.each([
    "javascript:alert(1)",
    "data:image/png;base64,a",
    "ftp://example.com/a",
  ])("rejects unsafe covers %s on create and update", async (coverImageUrl) => {
    await expect(service.createEvent(2, { ...input, coverImageUrl })).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
    await expect(service.updateEvent(2, "event", { coverImageUrl })).rejects.toMatchObject({
      code: ErrorCode.BadRequest,
    });
  });
  it.each([
    null,
    "http://example.com/a",
    "https://example.com/a",
  ])("accepts valid cover %s", async (coverImageUrl) => {
    await service.updateEvent(2, "event", { coverImageUrl });
    expect(repository.update).toHaveBeenCalledWith("event", { coverImageUrl });
  });
  it("requires the RSVP uid for public updates and never returns stored notes", async () => {
    repository.findRsvp.mockResolvedValue({ uid: rsvp.uid });
    for (const options of [{}, { rsvpUid: "wrong" }])
      await expect(service.rsvp("event", rsvp, options)).rejects.toMatchObject({ code: "RSVP_EXISTS" });
    expect(repository.upsertRsvp).not.toHaveBeenCalled();
    expect(await service.rsvp("event", rsvp, { rsvpUid: rsvp.uid })).toEqual({
      uid: rsvp.uid,
      status: rsvp.status,
      plusOnes: 1,
    });
    expect(await service.rsvp("event", rsvp, { trusted: true })).toMatchObject({ note: rsvp.note });
  });
});
