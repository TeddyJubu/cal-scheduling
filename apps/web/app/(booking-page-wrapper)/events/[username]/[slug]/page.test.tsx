import { communityEventService } from "@calcom/features/community-events/service";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "./page";

vi.mock("@calcom/features/community-events/service", () => ({
  communityEventService: { getPublicEvent: vi.fn() },
}));
vi.mock("@calcom/features/auth/lib/getLocale", () => ({ getLocale: async () => "fr" }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => ({}), cookies: async () => ({}) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("app/_utils", () => ({ getTranslate: async () => (key: string) => key }));
vi.mock("./RsvpForm", () => ({ default: () => null }));
vi.mock("@calcom/ui/components/alert/Alert", () => ({ Alert: () => null }));
const event = {
  uid: "event",
  slug: "books",
  title: "Reading party",
  description: "Read together",
  category: null,
  coverImageUrl: null,
  startTime: "2099-01-01T18:00:00Z",
  endTime: "2099-01-01T20:00:00Z",
  timeZone: "Europe/Paris",
  location: null,
  capacity: null,
  status: "SCHEDULED" as const,
  hidden: true,
  host: { name: "Host", username: "host" },
  goingCount: 0,
  maybeCount: 0,
  spotsLeft: null,
  attendees: [],
};
const props = { params: Promise.resolve({ username: "host", slug: "books" }) };
beforeEach(() => {
  vi.restoreAllMocks();
  vi.mocked(communityEventService.getPublicEvent).mockResolvedValue(event);
});
describe("Community event page", () => {
  it("uses event metadata and prevents indexing hidden events", async () => {
    expect(await generateMetadata(props)).toEqual({
      title: event.title,
      description: event.description,
      robots: { index: false },
    });
  });
  it("allows listed events to be indexed and handles empty descriptions", async () => {
    vi.mocked(communityEventService.getPublicEvent).mockResolvedValue({
      ...event,
      hidden: false,
      description: null,
    });
    expect(await generateMetadata(props)).toEqual({ title: event.title, description: undefined });
  });
  it("returns 404 for missing metadata", async () => {
    vi.mocked(communityEventService.getPublicEvent).mockRejectedValue(
      new ErrorWithCode(ErrorCode.NotFound, "Missing")
    );
    await expect(generateMetadata(props)).rejects.toThrow("404");
  });
  it("formats event dates in the resolved visitor locale and event timezone", async () => {
    const Original = Intl.DateTimeFormat;
    const format = vi.spyOn(Intl, "DateTimeFormat").mockImplementation(function (locale, options) {
      return new Original(locale, options);
    });
    await Page(props);
    expect(format).toHaveBeenCalledWith("fr", expect.objectContaining({ timeZone: event.timeZone }));
  });
});
