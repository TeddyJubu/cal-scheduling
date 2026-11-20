import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { slugify } from "@calcom/lib/slugify";
import type { z } from "zod";
import type { CommunityEventRepository, EventRecord } from "./CommunityEventRepository";
import type { EventInput } from "./communityEvent";
import { eventInput, rsvpInput } from "./communityEvent";

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) throw new ErrorWithCode(ErrorCode.BadRequest, result.error.message);
  return result.data;
}
function validateTimes(event: { startTime: Date; endTime: Date }) {
  if (!(event.endTime > event.startTime))
    throw new ErrorWithCode(ErrorCode.BadRequest, "endTime must be after startTime");
}
function eventDto(event: EventRecord) {
  return {
    uid: event.uid,
    slug: event.slug,
    title: event.title,
    description: event.description,
    category: event.category,
    coverImageUrl: event.coverImageUrl,
    startTime: event.startTime.toISOString(),
    endTime: event.endTime.toISOString(),
    timeZone: event.timeZone,
    location: event.location,
    capacity: event.capacity,
    status: event.status,
    hidden: event.hidden,
    host: { name: event.user.name, username: event.user.username },
  };
}
function rsvpDto(rsvp: Awaited<ReturnType<CommunityEventRepository["upsertRsvp"]>>) {
  return {
    uid: rsvp.uid,
    name: rsvp.name,
    email: rsvp.email,
    status: rsvp.status,
    plusOnes: rsvp.plusOnes,
    note: rsvp.note,
    createdAt: rsvp.createdAt.toISOString(),
    updatedAt: rsvp.updatedAt.toISOString(),
  };
}

export class CommunityEventService {
  constructor(private readonly repository: CommunityEventRepository) {}

  private async event(uid: string, repository = this.repository) {
    const event = await repository.findByUid(uid);
    if (!event) throw new ErrorWithCode(ErrorCode.NotFound, "Community event not found");
    return event;
  }
  private owner(event: EventRecord, userId: number) {
    if (event.userId !== userId)
      throw new ErrorWithCode(ErrorCode.Forbidden, "Only the event owner can perform this action");
  }
  private async save(operation: () => Promise<EventRecord>) {
    try {
      return eventDto(await operation());
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "P2002") {
        throw new ErrorWithCode(ErrorCode.BadRequest, "An event with this slug already exists for this user");
      }
      throw error;
    }
  }
  async createEvent(userId: number, input: EventInput) {
    const data = parse(eventInput, input);
    validateTimes(data);
    const slug = slugify(data.slug ?? data.title);
    if (!slug) throw new ErrorWithCode(ErrorCode.BadRequest, "A non-empty event slug is required");
    return this.save(() => this.repository.create({ ...data, userId, slug }));
  }
  async updateEvent(userId: number, uid: string, input: Partial<EventInput>) {
    const data = parse(
      eventInput.partial(),
      Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined))
    );
    return this.repository.withEventLock(uid, async (repository) => {
      const event = await this.event(uid, repository);
      this.owner(event, userId);
      validateTimes({ ...event, ...data });
      if (data.capacity !== undefined && data.capacity !== null) {
        const groups = await repository.aggregateCounts(event.id);
        const going = groups.find((group) => group.status === "GOING");
        if (data.capacity < (going?._count._all ?? 0) + (going?._sum.plusOnes ?? 0))
          throw new ErrorWithCode(ErrorCode.BadRequest, "Capacity cannot be lower than current attendance");
      }
      if (data.slug !== undefined) {
        data.slug = slugify(data.slug);
        if (!data.slug) throw new ErrorWithCode(ErrorCode.BadRequest, "A non-empty event slug is required");
      }
      return this.save(() => repository.update(uid, data));
    });
  }
  async cancelEvent(userId: number, uid: string) {
    return this.repository.withEventLock(uid, async (repository) => {
      this.owner(await this.event(uid, repository), userId);
      return eventDto(await repository.update(uid, { status: "CANCELLED" }));
    });
  }
  private async publicDto(event: EventRecord) {
    const rsvps = await this.repository.listRsvps(event.id);
    const goingCount = rsvps.filter((r) => r.status === "GOING").reduce((sum, r) => sum + 1 + r.plusOnes, 0);
    return {
      ...eventDto(event),
      goingCount,
      maybeCount: rsvps.filter((r) => r.status === "MAYBE").length,
      spotsLeft: event.capacity === null ? null : Math.max(0, event.capacity - goingCount),
      attendees: event.showAttendees
        ? rsvps.filter((r) => r.status === "GOING").map((r) => r.name.trim().split(/\s+/)[0])
        : [],
    };
  }
  async getPublicEvent(username: string, slug: string) {
    const event = await this.repository.findByUserAndSlug(username, slug);
    if (!event) throw new ErrorWithCode(ErrorCode.NotFound, "Community event not found");
    return this.publicDto(event);
  }
  async getPublicEventByUid(uid: string) {
    return this.publicDto(await this.event(uid));
  }

  async rsvp(
    eventUid: string,
    input: z.input<typeof rsvpInput>,
    options: { rsvpUid?: string; trusted?: boolean } = {}
  ) {
    const data = parse(rsvpInput, input);
    return this.repository.withEventLock(eventUid, async (repository) => {
      const event = await this.event(eventUid, repository);
      if (event.status === "CANCELLED" || event.endTime <= new Date())
        throw new ErrorWithCode(ErrorCode.BadRequest, "This event is cancelled or has ended");
      if (!options.trusted) {
        const existing = await repository.findRsvp(event.id, data.email);
        if (existing && existing.uid !== options.rsvpUid)
          throw new ErrorWithCode(
            ErrorCode.CommunityEventRsvpExists,
            "An RSVP already exists for this email"
          );
      }
      if (data.status === "GOING" && event.capacity !== null) {
        const groups = await repository.aggregateCounts(event.id, data.email);
        const going = groups.find((group) => group.status === "GOING");
        const count = (going?._count._all ?? 0) + (going?._sum.plusOnes ?? 0);
        if (count + 1 + data.plusOnes > event.capacity)
          throw new ErrorWithCode(ErrorCode.CommunityEventFull, "This event is full");
      }
      const saved = await repository.upsertRsvp(event.id, data);
      if (!options.trusted) return { uid: saved.uid, status: saved.status, plusOnes: saved.plusOnes };
      return rsvpDto(saved);
    });
  }
  async listRsvps(userId: number, uid: string) {
    const event = await this.event(uid);
    this.owner(event, userId);
    return (await this.repository.listRsvps(event.id)).map(rsvpDto);
  }
}
