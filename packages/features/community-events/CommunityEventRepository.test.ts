import type { Prisma, PrismaClient } from "@calcom/prisma/generated/prisma/client";
import { describe, expect, it, vi } from "vitest";
import { mockDeep } from "vitest-mock-extended";
import { CommunityEventRepository } from "./CommunityEventRepository";

describe("CommunityEventRepository", () => {
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
