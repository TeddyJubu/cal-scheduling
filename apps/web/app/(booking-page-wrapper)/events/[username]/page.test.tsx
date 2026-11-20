import { communityEventService } from "@calcom/features/community-events/service";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import Page, { generateMetadata } from "./page";

vi.mock("@calcom/features/community-events/service", () => ({
  communityEventService: { listPublicEvents: vi.fn() },
}));
vi.mock("@calcom/features/auth/lib/getLocale", () => ({ getLocale: async () => "fr" }));
vi.mock("@lib/buildLegacyCtx", () => ({ buildLegacyRequest: () => ({}) }));
vi.mock("next/headers", () => ({ headers: async () => ({}), cookies: async () => ({}) }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("404");
  },
}));
vi.mock("app/_utils", () => ({
  getTranslate: async () => (key: string, options?: { name: string }) =>
    key === "community_events_heading" ? `${options?.name}'s events` : key,
}));
vi.mock("@calcom/ui/components/button/Button", () => ({
  Button: ({ href, children }: { href?: string; children: ReactNode }) =>
    href ? <a href={href}>{children}</a> : <button type="submit">{children}</button>,
}));
const event = {
  uid: "event",
  slug: "reading",
  title: "Reading night",
  description: null,
  category: "Books",
  coverImageUrl: null,
  startTime: "2026-12-01T01:00:00Z",
  endTime: "2026-12-01T02:00:00Z",
  timeZone: "America/New_York",
  location: "Library",
  capacity: 4,
  hidden: false,
  status: "CANCELLED" as const,
  host: { name: "Host", username: "host" },
  goingCount: 4,
  maybeCount: 0,
  spotsLeft: 0,
};
const props = { params: Promise.resolve({ username: "host" }), searchParams: Promise.resolve({}) };
const list = vi.mocked(communityEventService.listPublicEvents);
const data = { host: event.host, categories: ["Books"], events: [event] };
beforeEach(() => {
  list.mockReset().mockResolvedValue(data);
});
afterEach(cleanup);
it("renders public cards, counts, cancellation and host metadata", async () => {
  render(await Page(props));
  expect(screen.getByRole("heading", { name: "Host" })).toBeTruthy();
  expect(screen.getByText("Reading night").closest("a")?.getAttribute("href")).toBe("/events/host/reading");
  expect(screen.getByText("community_events_cancelled")).toBeTruthy();
  expect(screen.getByText(/community_event_full/)).toBeTruthy();
  expect(await generateMetadata(props)).toMatchObject({ title: "Host's events" });
});
it("places calendar events on their local day and preserves filters in month navigation", async () => {
  const searchParams = Promise.resolve({ view: "calendar", month: "2026-11", category: "Books" });
  render(await Page({ ...props, searchParams }));
  const cell = screen.getByText("Reading night").closest("li");
  expect(cell?.querySelector("time")?.getAttribute("datetime")).toBe("2026-11-30");
  const next = screen.getByRole("link", { name: "community_events_next" }).getAttribute("href");
  expect(next).toContain("month=2026-12");
  expect(next).toContain("category=Books");
  expect(screen.getByRole("heading", { name: "novembre 2026" })).toBeTruthy();
});
it("renders empty hosts and returns 404 for missing hosts or invalid months", async () => {
  list.mockResolvedValue({ ...data, categories: [], events: [] });
  render(await Page(props));
  expect(screen.getByText("community_events_empty")).toBeTruthy();
  list.mockRejectedValue(new ErrorWithCode(ErrorCode.NotFound, "Missing"));
  await expect(Page(props)).rejects.toThrow("404");
  await expect(generateMetadata(props)).rejects.toThrow("404");
  await expect(
    Page({ ...props, searchParams: Promise.resolve({ view: "calendar", month: "2026-13" }) })
  ).rejects.toThrow("404");
});
