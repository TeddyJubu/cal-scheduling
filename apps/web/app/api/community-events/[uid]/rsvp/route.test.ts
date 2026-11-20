import { communityEventService } from "@calcom/features/community-events/service";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { HttpError } from "@calcom/lib/http-error";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

vi.mock("@calcom/features/community-events/service", () => ({ communityEventService: { rsvp: vi.fn() } }));
vi.mock("@calcom/lib/checkRateLimitAndThrowError", () => ({ checkRateLimitAndThrowError: vi.fn() }));
const input = { name: "Reader One", email: "READER@example.com", status: "GOING" };
const context = { params: Promise.resolve({ uid: "event-uid" }) };
function send(body: unknown) {
  return POST(
    new Request("http://localhost/api/community-events/event-uid/rsvp", {
      method: "POST",
      headers: { "x-forwarded-for": "192.0.2.1" },
      body: JSON.stringify(body),
    }),
    context
  );
}
beforeEach(() => vi.resetAllMocks());
describe("Public RSVP route", () => {
  it.each([
    null,
    {},
    { ...input, email: "invalid" },
    { ...input, plusOnes: 11 },
    { ...input, status: "OTHER" },
    { ...input, rsvpUid: 123 },
  ])("rejects invalid input %j", async (body) => {
    expect((await send(body)).status).toBe(400);
    expect(communityEventService.rsvp).not.toHaveBeenCalled();
  });
  it("rejects malformed JSON", async () => {
    expect((await POST(new Request("http://localhost", { method: "POST", body: "{" }), context)).status).toBe(
      400
    );
  });
  it("normalizes input and never returns personal details", async () => {
    vi.mocked(communityEventService.rsvp).mockResolvedValue({
      uid: "rsvp-uid",
      name: input.name,
      email: "reader@example.com",
      status: "GOING",
      plusOnes: 0,
      note: "private",
      createdAt: "now",
      updatedAt: "now",
    });
    const response = await send(input);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "success",
      data: { uid: "rsvp-uid", status: "GOING", plusOnes: 0 },
    });
    expect(communityEventService.rsvp).toHaveBeenCalledWith(
      "event-uid",
      {
        ...input,
        email: "reader@example.com",
      },
      { rsvpUid: undefined, trusted: false }
    );
    expect(checkRateLimitAndThrowError).toHaveBeenCalledWith({
      rateLimitingType: "core",
      identifier: `community-event-rsvp:event-uid:${piiHasher.hash("192.0.2.1")}`,
    });
  });
  it.each([
    [ErrorCode.CommunityEventFull, 409],
    [ErrorCode.CommunityEventRsvpExists, 409],
    [ErrorCode.NotFound, 404],
    [ErrorCode.BadRequest, 400],
  ] as const)("maps %s to %s", async (code, status) => {
    vi.mocked(communityEventService.rsvp).mockRejectedValue(new ErrorWithCode(code, "private details"));
    const response = await send(input);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error: code });
  });
  it("enforces rate limits before writing", async () => {
    vi.mocked(checkRateLimitAndThrowError).mockRejectedValue(
      new HttpError({ statusCode: 429, message: "limited" })
    );
    expect((await send(input)).status).toBe(429);
    expect(communityEventService.rsvp).not.toHaveBeenCalled();
  });
  it("passes a returning visitor's token without trusting body flags", async () => {
    vi.mocked(communityEventService.rsvp).mockResolvedValue({ uid: "saved", status: "GOING", plusOnes: 2 });
    const response = await send({ ...input, rsvpUid: "saved", trusted: true });
    expect(response.status).toBe(200);
    expect((await response.json()).data.plusOnes).toBe(2);
    expect(vi.mocked(communityEventService.rsvp).mock.calls[0][1]).not.toHaveProperty("plusOnes");
    expect(communityEventService.rsvp).toHaveBeenCalledWith(
      "event-uid",
      expect.not.objectContaining({ rsvpUid: expect.anything() }),
      { rsvpUid: "saved", trusted: false }
    );
  });
  it("redacts unexpected errors", async () => {
    vi.mocked(communityEventService.rsvp).mockRejectedValue(new Error("reader@example.com"));
    const response = await send(input);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: ErrorCode.InternalServerError });
  });
});
