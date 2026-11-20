import type { Prisma, PrismaClient } from "@calcom/prisma/generated/prisma/client";
import { fromZonedTime } from "date-fns-tz";

const eventSelect = {
  id: true,
  uid: true,
  userId: true,
  slug: true,
  title: true,
  description: true,
  category: true,
  coverImageUrl: true,
  startTime: true,
  endTime: true,
  timeZone: true,
  location: true,
  capacity: true,
  hidden: true,
  showAttendees: true,
  status: true,
  user: { select: { name: true, username: true } },
} satisfies Prisma.CommunityEventSelect;
const rsvpSelect = {
  uid: true,
  name: true,
  email: true,
  status: true,
  plusOnes: true,
  note: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.CommunityEventRsvpSelect;

export class CommunityEventRepository {
  constructor(private readonly prismaClient: PrismaClient | Prisma.TransactionClient) {}

  create(data: Prisma.CommunityEventUncheckedCreateInput) {
    return this.prismaClient.communityEvent.create({ data, select: eventSelect });
  }
  findByUid(uid: string) {
    return this.prismaClient.communityEvent.findUnique({ where: { uid }, select: eventSelect });
  }
  findByUserAndSlug(user: number | string, slug: string) {
    const where =
      typeof user === "number"
        ? { userId: user, slug }
        : { user: { username: user, organizationId: null }, slug };
    return this.prismaClient.communityEvent.findFirst({ where, select: eventSelect });
  }
  findPublicHost(username: string) {
    return this.prismaClient.user.findFirst({
      where: { username, organizationId: null },
      select: { id: true, name: true, username: true },
    });
  }
  publicFacets(userId: number) {
    return this.prismaClient.communityEvent.findMany({
      where: { userId, hidden: false },
      distinct: ["category", "timeZone"],
      select: { category: true, timeZone: true },
    });
  }
  listPublicEvents(
    userId: number,
    options: { tab: "upcoming" | "past"; category?: string; month?: string; timeZones: string[] }
  ) {
    const direction = options.tab === "past" ? "desc" : "asc";
    const next = options.month ? new Date(`${options.month}-01T00:00:00Z`) : new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    return this.prismaClient.communityEvent.findMany({
      where: {
        userId,
        hidden: false,
        category: options.category,
        endTime: options.tab === "past" ? { lte: new Date() } : { gt: new Date() },
        ...(options.month
          ? {
              OR: options.timeZones.map((timeZone) => ({
                timeZone,
                startTime: {
                  gte: fromZonedTime(`${options.month}-01T00:00:00`, timeZone),
                  lt: fromZonedTime(next.toISOString().split("T")[0] + "T00:00:00", timeZone),
                },
              })),
            }
          : {}),
      },
      orderBy: [{ startTime: direction }, { id: direction }],
      take: 50,
      select: eventSelect,
    });
  }
  publicCounts(eventIds: number[]) {
    return this.prismaClient.communityEventRsvp.groupBy({
      by: ["eventId", "status"],
      where: { eventId: { in: eventIds } },
      _count: { _all: true },
      _sum: { plusOnes: true },
    });
  }
  listByUser(
    userId: number,
    { period, take = 20, skip = 0 }: { period?: "upcoming" | "past"; take?: number; skip?: number } = {}
  ) {
    let endTime: Prisma.DateTimeFilter | undefined;
    if (period === "past") endTime = { lt: new Date() };
    if (period === "upcoming") endTime = { gte: new Date() };
    return this.prismaClient.communityEvent.findMany({
      where: { userId, endTime },
      take,
      skip,
      orderBy: [{ startTime: "asc" }, { id: "asc" }],
      select: eventSelect,
    });
  }
  update(uid: string, data: Prisma.CommunityEventUncheckedUpdateInput) {
    return this.prismaClient.communityEvent.update({ where: { uid }, data, select: eventSelect });
  }
  upsertRsvp(eventId: number, data: Prisma.CommunityEventRsvpCreateWithoutEventInput) {
    return this.prismaClient.communityEventRsvp.upsert({
      where: { eventId_email: { eventId, email: data.email } },
      create: { ...data, eventId },
      update: data,
      select: rsvpSelect,
    });
  }
  findRsvp(eventId: number, email: string) {
    return this.prismaClient.communityEventRsvp.findUnique({
      where: { eventId_email: { eventId, email } },
      select: { uid: true },
    });
  }
  listRsvps(eventId: number) {
    return this.prismaClient.communityEventRsvp.findMany({
      where: { eventId },
      select: rsvpSelect,
      orderBy: { id: "asc" },
    });
  }
  aggregateCounts(eventId: number, excludeEmail?: string) {
    return this.prismaClient.communityEventRsvp.groupBy({
      by: ["status"],
      where: { eventId, ...(excludeEmail ? { email: { not: excludeEmail } } : {}) },
      _count: { _all: true },
      _sum: { plusOnes: true },
    });
  }
  async withEventLock<T>(
    uid: string,
    operation: (repository: CommunityEventRepository) => Promise<T>
  ): Promise<T> {
    const locked = async (tx: Prisma.TransactionClient) => {
      // Serialize capacity checks and writes across processes, not just within one server.
      await tx.$queryRaw`SELECT "id" FROM "CommunityEvent" WHERE "uid" = ${uid} FOR UPDATE`;
      return operation(new CommunityEventRepository(tx));
    };
    if (!("$transaction" in this.prismaClient)) return locked(this.prismaClient);
    return this.prismaClient.$transaction(locked);
  }
}

export type EventRecord = NonNullable<Awaited<ReturnType<CommunityEventRepository["findByUid"]>>>;
