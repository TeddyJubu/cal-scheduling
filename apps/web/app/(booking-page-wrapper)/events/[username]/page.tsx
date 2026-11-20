import { getLocale } from "@calcom/features/auth/lib/getLocale";
import type { PublicEventListInput } from "@calcom/features/community-events/communityEvent";
import { publicEventListInput } from "@calcom/features/community-events/communityEvent";
import { communityEventService } from "@calcom/features/community-events/service";
import { ErrorCode } from "@calcom/lib/errorCodes";
import { ErrorWithCode } from "@calcom/lib/errors";
import { Button } from "@calcom/ui/components/button/Button";
import { buildLegacyRequest } from "@lib/buildLegacyCtx";
import { getTranslate } from "app/_utils";
import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

type Props = {
  params: Promise<{ username: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};
function eventDay(start: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(start));
  return ["year", "month", "day"].map((part) => parts.find((p) => p.type === part)?.value).join("-");
}
async function load(username: string, options: PublicEventListInput = {}) {
  return communityEventService.listPublicEvents(username, options).catch((error: unknown) => {
    if (error instanceof ErrorWithCode && error.code === ErrorCode.NotFound) notFound();
    throw error;
  });
}
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { username } = await params;
  const [{ host }, t] = await Promise.all([load(username), getTranslate()]);
  return {
    title: t("community_events_heading", { name: host.name ?? username }),
    description: t("community_events_intro"),
  };
}
export default async function HostEvents({ params, searchParams }: Props) {
  const { username } = await params;
  const query = await searchParams;
  const value = (key: string) => (typeof query[key] === "string" ? query[key] : undefined);
  const view = value("view") === "calendar" ? "calendar" : undefined;
  const calendar = Boolean(view);
  const month = value("month") ?? new Date().toISOString().slice(0, 7);
  const parsed = publicEventListInput.safeParse({
    tab: value("tab"),
    category: value("category") || undefined,
    month: calendar ? month : undefined,
  });
  if (!parsed.success) notFound();
  const { host, events, categories } = await load(username, parsed.data);
  const t = await getTranslate();
  const locale = (await getLocale(buildLegacyRequest(await headers(), await cookies()))) ?? "en";
  const base = `/events/${encodeURIComponent(username)}`;
  const href = (changes: Record<string, string | undefined>) => {
    const search = new URLSearchParams();
    for (const [key, v] of Object.entries({ ...parsed.data, view, ...changes })) if (v) search.set(key, v);
    return `${base}?${search}`;
  };
  const eventHref = (slug: string) => `${base}/${encodeURIComponent(slug)}`;
  const toggle = (key: string, q: Record<string, string | undefined>, active: boolean) => (
    <Button
      href={href(q)}
      color={active ? "primary" : "secondary"}
      aria-current={active ? "page" : undefined}>
      {t(key)}
    </Button>
  );
  const format = (date: Date | string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(locale, options).format(new Date(date));
  const first = new Date(`${calendar ? month : new Date().toISOString().slice(0, 7)}-01T00:00:00Z`);
  const shifted = (offset: number) => {
    const date = new Date(first);
    date.setUTCMonth(date.getUTCMonth() + offset);
    return date;
  };
  const days = new Map<string, typeof events>();
  for (const event of events) {
    const key = eventDay(event.startTime, event.timeZone);
    days.set(key, [...(days.get(key) ?? []), event]);
  }
  const offset = (first.getUTCDay() + 6) % 7;
  const weekdays = Array.from({ length: 7 }, (_, i) =>
    format(new Date(first.getTime() + (i - offset) * 86400000), { weekday: "short", timeZone: "UTC" })
  );
  const cells = Math.ceil((offset + new Date(shifted(1).getTime() - 86400000).getUTCDate()) / 7) * 7;
  return (
    <main className="mx-auto max-w-5xl px-4 py-12 text-default">
      <header className="mb-8 space-y-2">
        <p className="font-medium text-sm text-subtle">{t("community_events_label")}</p>
        <h1 className="font-semibold text-3xl tracking-tight">{host.name ?? username}</h1>
        <p className="text-subtle">{t("community_events_intro")}</p>
      </header>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <nav aria-label={t("community_events_browse")} className="flex gap-2">
          {toggle("upcoming", { tab: "upcoming" }, parsed.data.tab === "upcoming")}
          {toggle("past", { tab: "past" }, parsed.data.tab === "past")}
        </nav>
        <nav aria-label={t("community_events_display")} className="flex gap-2">
          {toggle("list_view", { view: undefined, month: undefined }, !calendar)}
          {toggle("calendar", { view: "calendar", month }, calendar)}
        </nav>
      </div>
      <form action={base} className="mb-8 flex flex-wrap items-center gap-3">
        <input type="hidden" name="tab" value={parsed.data.tab} />
        {calendar && (
          <>
            <input type="hidden" name="view" value="calendar" />
            <input type="hidden" name="month" value={month} />
          </>
        )}
        <label htmlFor="category" className="font-medium text-sm">
          {t("community_events_category")}
        </label>
        <select
          id="category"
          name="category"
          defaultValue={parsed.data.category ?? ""}
          className="rounded-md border border-default bg-default px-3 py-2 text-sm">
          <option value="">{t("community_events_all_categories")}</option>
          {categories.map((category) => (
            <option key={category} value={category}>
              {category}
            </option>
          ))}
        </select>
        <Button type="submit" color="secondary">
          {t("community_events_filter")}
        </Button>
      </form>
      {calendar ? (
        <section aria-label={t("calendar")}>
          <div className="mb-4 flex items-center justify-between gap-2">
            <Link href={href({ month: shifted(-1).toISOString().slice(0, 7) })} className="text-sm underline">
              {t("community_events_previous")}
            </Link>
            <h2 className="font-semibold text-lg">
              {format(first, { month: "long", year: "numeric", timeZone: "UTC" })}
            </h2>
            <Link href={href({ month: shifted(1).toISOString().slice(0, 7) })} className="text-sm underline">
              {t("community_events_next")}
            </Link>
          </div>
          <div className="grid grid-cols-7" aria-hidden="true">
            {weekdays.map((day) => (
              <span key={day} className="p-2 text-center text-subtle text-xs">
                {day}
              </span>
            ))}
          </div>
          <ol className="grid grid-cols-7">
            {Array.from({ length: cells }, (_, day) => {
              const date = new Date(first);
              date.setUTCDate(1 - offset + day);
              const key = date.toISOString().slice(0, 10);
              const active = date.getUTCMonth() === first.getUTCMonth();
              return (
                <li
                  key={key}
                  aria-label={format(date, { dateStyle: "full", timeZone: "UTC" })}
                  className={`min-h-28 border border-subtle p-1 md:p-2 ${active ? "bg-default" : "bg-subtle text-muted"}`}>
                  <time dateTime={key} className="text-xs">
                    {new Intl.NumberFormat(locale).format(date.getUTCDate())}
                  </time>
                  {active &&
                    days.get(key)?.map((event) => (
                      <Link
                        key={event.uid}
                        href={eventHref(event.slug)}
                        className="mt-1 block rounded bg-subtle p-1 font-medium text-xs hover:underline">
                        {event.title}
                        {event.status === "CANCELLED" && (
                          <span className="block text-error">{t("community_events_cancelled")}</span>
                        )}
                      </Link>
                    ))}
                </li>
              );
            })}
          </ol>
        </section>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          {events.map((event) => (
            <Link
              key={event.uid}
              href={eventHref(event.slug)}
              className="overflow-hidden rounded-xl border border-subtle bg-default transition-shadow hover:shadow-md">
              {event.coverImageUrl ? (
                <div className="relative h-40">
                  <Image src={event.coverImageUrl} alt="" fill unoptimized className="object-cover" />
                </div>
              ) : (
                <div className="h-40 bg-gradient-to-br from-indigo-100 to-emerald-100" aria-hidden="true" />
              )}
              <div className="space-y-2 p-5">
                <div className="flex flex-wrap items-center gap-2">
                  {event.category && <p className="font-semibold text-subtle text-xs">{event.category}</p>}
                  {event.status === "CANCELLED" && (
                    <span className="rounded bg-error px-2 py-1 font-medium text-error text-xs">
                      {t("community_events_cancelled")}
                    </span>
                  )}
                </div>
                <h2 className="font-semibold text-xl">{event.title}</h2>
                <p className="text-sm text-subtle">
                  <time dateTime={event.startTime}>
                    {format(event.startTime, {
                      timeZone: event.timeZone,
                      dateStyle: "medium",
                      timeStyle: "short",
                    })}
                  </time>
                  {" · "}
                  {event.timeZone}
                </p>
                {event.location && <p className="text-sm text-subtle">{event.location}</p>}
                <p className="font-medium text-sm">
                  {[
                    t("community_events_going", { count: event.goingCount }),
                    event.spotsLeft !== null &&
                      t(event.spotsLeft === 0 ? "community_event_full" : "community_event_spots", {
                        count: event.spotsLeft,
                      }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </p>
              </div>
            </Link>
          ))}
        </div>
      )}
      {!events.length && <p className="my-12 text-center text-subtle">{t("community_events_empty")}</p>}
      <p className="mt-6 text-subtle text-xs">{t("community_events_limit")}</p>
    </main>
  );
}
