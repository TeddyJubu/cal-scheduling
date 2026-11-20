import { getLocale } from "@calcom/features/auth/lib/getLocale";
import { communityEventService } from "@calcom/features/community-events/service";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Alert } from "@calcom/ui/components/alert/Alert";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { getTranslate } from "app/_utils";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Image from "next/image";
import { notFound } from "next/navigation";
import RsvpForm from "./RsvpForm";

type Props = {
  params: Promise<{ username: string; slug: string }>;
};
const loadEvent = (username: string, slug: string) =>
  communityEventService.getPublicEvent(username, slug).catch((error: unknown) => {
    if (error instanceof ErrorWithCode && error.code === ErrorCode.NotFound) notFound();
    throw error;
  });
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username, slug } = await params;
  const event = await loadEvent(username, slug);
  return {
    title: event.title,
    description: event.description ?? undefined,
    ...(event.hidden ? { robots: { index: false } } : {}),
  };
}
export default async function CommunityEventPage({ params }: Props) {
  const { username, slug } = await params;
  const event = await loadEvent(username, slug);
  const t = await getTranslate();
  const locale = await getLocale(buildLegacyRequest(await headers(), await cookies()));
  const format = new Intl.DateTimeFormat(locale ?? "en", {
    timeZone: event.timeZone,
    dateStyle: "full",
    timeStyle: "short",
  });
  let closed: string | null = null;
  if (event.status === "CANCELLED") closed = "community_event_cancelled";
  else if (new Date(event.endTime) <= new Date()) closed = "community_event_ended";
  return (
    <main className="mx-auto max-w-2xl px-6 py-12 text-default">
      {event.coverImageUrl && (
        <Image
          src={event.coverImageUrl}
          width={1200}
          height={600}
          unoptimized
          alt={t("community_event_cover", { title: event.title })}
          className="mb-8 max-h-80 w-full rounded-2xl object-cover"
        />
      )}
      {event.category && (
        <p className="mb-3 font-semibold text-sm text-subtle uppercase tracking-wide">{event.category}</p>
      )}
      <h1 className="mb-4 font-semibold text-4xl tracking-tight">{event.title}</h1>
      <p className="mb-6 text-subtle">
        {t("community_event_host", { name: event.host.name ?? event.host.username })}
      </p>
      <section className="mb-8 space-y-3 rounded-xl border border-subtle bg-default p-6">
        <p>
          <time dateTime={event.startTime}>{format.format(new Date(event.startTime))}</time>
          {" – "}
          <time dateTime={event.endTime}>{format.format(new Date(event.endTime))}</time> ({event.timeZone})
        </p>
        {event.location && (
          <p>
            {/^https?:\/\//i.test(event.location) ? (
              <a className="underline" href={event.location} target="_blank" rel="noopener noreferrer">
                {event.location}
              </a>
            ) : (
              event.location
            )}
          </p>
        )}
        <p className="font-medium">
          {t("community_event_counts", { going: event.goingCount, maybe: event.maybeCount })}
          {event.spotsLeft !== null && (
            <>
              {" "}
              ·{" "}
              {event.spotsLeft === 0
                ? t("community_event_full")
                : t("community_event_spots", { count: event.spotsLeft })}
            </>
          )}
        </p>
        {event.attendees.length > 0 && (
          <p className="text-sm text-subtle">
            {t("community_event_attendees", { names: event.attendees.join(", ") })}
          </p>
        )}
      </section>
      {event.description && (
        <p className="mb-8 whitespace-pre-wrap break-words leading-relaxed">{event.description}</p>
      )}
      {closed ? <Alert severity="warning" message={t(closed)} /> : <RsvpForm uid={event.uid} />}
    </main>
  );
}
