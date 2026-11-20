import type { Prisma, PrismaClient } from "@calcom/prisma/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { CommunityEventRepository } from "./CommunityEventRepository";

describe("CommunityEventRepository", () => {
  it.each([
    "upcoming",
    "past",
  ] as const)("scopes and caps %s listings, respecting local month boundaries", async (tab) => {
    const prisma = mockDeep<PrismaClient>();
    const repository = new CommunityEventRepository(prisma);
    await repository.findPublicHost("host");
    expect(prisma.user.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { username: "host", organizationId: null } })
    );
    await repository.publicFacets(2);
    expect(prisma.communityEvent.findMany.mock.calls[0][0]?.where).toEqual({ userId: 2, hidden: false });
    await repository.listPublicEvents(2, {
      tab,
      category: "Books",
      month: "2026-11",
      timeZones: ["America/New_York"],
    });
    const args = prisma.communityEvent.findMany.mock.calls[1][0];
    const direction = tab === "past" ? "desc" : "asc";
    expect(args).toMatchObject({ take: 50, where: { userId: 2, hidden: false, category: "Books" } });
    expect(args?.orderBy).toEqual([{ startTime: direction }, { id: direction }]);
    expect(args?.where?.endTime).toEqual(
      tab === "past" ? { lte: expect.any(Date) } : { gt: expect.any(Date) }
    );
    expect(args?.where?.OR).toEqual([
      {
        timeZone: "America/New_York",
        startTime: { gte: new Date("2026-11-01T04:00:00Z"), lt: new Date("2026-12-01T05:00:00Z") },
      },
    ]);
    await repository.publicCounts([1, 3]);
    expect(vi.mocked(prisma.communityEventRsvp.groupBy).mock.calls[0][0]).toMatchObject({
      by: ["eventId", "status"],
      where: { eventId: { in: [1, 3] } },
    });
  });
  it("locks an existing transaction before the operation", async () => {
    const tx = mockDeep<Prisma.TransactionClient>();
    tx.$queryRaw.mockResolvedValue([]);
    const operation = vi.fn(async () => {
      expect(tx.$queryRaw).toHaveBeenCalledOnce();
      return "saved";
    });
    expect(await new CommunityEventRepository(tx).withEventLock("uid", operation)).toBe("saved");
    expect(tx.$queryRaw.mock.calls[0][0]).toEqual(
      expect.arrayContaining([expect.stringContaining("FOR UPDATE")])
    );
    expect(tx.$queryRaw.mock.calls[0][1]).toBe("uid");
  });
  it("limits username lookups to non-organization users", async () => {
    const prisma = mockDeep<PrismaClient>();
    await new CommunityEventRepository(prisma).findByUserAndSlug("host", "books");
    expect(prisma.communityEvent.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { user: { username: "host", organizationId: null }, slug: "books" } })
    );
  });
});
