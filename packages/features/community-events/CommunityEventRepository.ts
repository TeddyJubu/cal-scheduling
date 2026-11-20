import type { Prisma, PrismaClient } from "@calcom/prisma/generated/prisma/client";

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
      select: { uid: true, plusOnes: true },
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
