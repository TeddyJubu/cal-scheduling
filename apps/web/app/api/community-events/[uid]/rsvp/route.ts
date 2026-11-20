import { rsvpInput } from "@calcom/features/community-events/communityEvent";
import { communityEventService } from "@calcom/features/community-events/service";
import { checkRateLimitAndThrowError } from "@calcom/lib/checkRateLimitAndThrowError";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import getIP from "@calcom/lib/getIP";
import { HttpError } from "@calcom/lib/http-error";
import { piiHasher } from "@calcom/lib/server/PiiHasher";
import { NextResponse } from "next/server";
import { z } from "zod";

export async function POST(request: Request, { params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  try {
    await checkRateLimitAndThrowError({
      rateLimitingType: "core",
      identifier: `community-event-rsvp:${uid}:${piiHasher.hash(getIP(request))}`,
    });
    const input = rsvpInput
      .extend({ rsvpUid: z.string().min(1).optional() })
      .safeParse(await request.json().catch(() => null));
    if (!input.success) return NextResponse.json({ error: ErrorCode.BadRequest }, { status: 400 });
    const { rsvpUid, ...data } = input.data;
    const rsvp = await communityEventService.rsvp(uid, data, { rsvpUid, trusted: false });
    return NextResponse.json({
      status: "success",
      data: { uid: rsvp.uid, status: rsvp.status, plusOnes: rsvp.plusOnes },
    });
  } catch (error) {
    if (error instanceof HttpError && error.statusCode === 429)
      return NextResponse.json({ error: "RATE_LIMITED" }, { status: 429 });
    if (error instanceof ErrorWithCode) {
      const statuses: Record<string, number> = {
        [ErrorCode.CommunityEventFull]: 409,
        [ErrorCode.CommunityEventRsvpExists]: 409,
        [ErrorCode.NotFound]: 404,
        [ErrorCode.BadRequest]: 400,
      };
      const status = statuses[error.code] ?? 500;
      return NextResponse.json({ error: error.code }, { status });
    }
    return NextResponse.json({ error: ErrorCode.InternalServerError }, { status: 500 });
  }
}
