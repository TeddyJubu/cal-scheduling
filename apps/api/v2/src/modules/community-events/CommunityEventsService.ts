import { CommunityEventRepository, CommunityEventService } from "@calcom/platform-libraries";
import { ErrorCode, ErrorWithCode, getHttpStatusCode } from "@calcom/platform-libraries/errors";
import { HttpException, Injectable } from "@nestjs/common";
import type { CommunityEventRsvpInput, CreateCommunityEventInput, UpdateCommunityEventInput } from "./inputs";
import { PrismaWriteService } from "@/modules/prisma/prisma-write.service";

@Injectable()
export class CommunityEventsService {
  private readonly domain: CommunityEventService;
  constructor(prisma: PrismaWriteService) {
    this.domain = new CommunityEventService(new CommunityEventRepository(prisma.prisma));
  }
  async execute<T>(operation: (domain: CommunityEventService) => Promise<T>): Promise<T> {
    try {
      return await operation(this.domain);
    } catch (error) {
      if (error instanceof ErrorWithCode) {
        throw new HttpException(
          error.message,
          error.code === ErrorCode.CommunityEventFull || error.code === ErrorCode.CommunityEventRsvpExists
            ? 409
            : getHttpStatusCode(error)
        );
      }
      throw error;
    }
  }
  create(userId: number, input: CreateCommunityEventInput) {
    return this.execute((domain) =>
      domain.createEvent(userId, {
        ...input,
        startTime: new Date(input.startTime),
        endTime: new Date(input.endTime),
      })
    );
  }
  update(userId: number, uid: string, input: UpdateCommunityEventInput) {
    const { startTime, endTime, ...data } = input;
    return this.execute((domain) =>
      domain.updateEvent(userId, uid, {
        ...data,
        ...(startTime === undefined ? {} : { startTime: new Date(startTime) }),
        ...(endTime === undefined ? {} : { endTime: new Date(endTime) }),
      })
    );
  }
  rsvp(userId: number, uid: string, input: CommunityEventRsvpInput) {
    return this.execute(async (domain) => {
      await domain.getOwnerEvent(userId, uid);
      return domain.rsvp(uid, input, { trusted: true });
    });
  }
}
