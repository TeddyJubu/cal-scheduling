"use client";

import { useLocale } from "@calcom/lib/hooks/useLocale";
import { Alert } from "@calcom/ui/components/alert/Alert";
import { Button } from "@calcom/ui/components/button/Button";
import { TextField } from "@calcom/ui/components/form/inputs/TextField";
import { useRouter } from "next/navigation";
import type { FormEvent } from "react";
import { useRef, useState } from "react";

const choices = {
  GOING: "community_event_going",
  MAYBE: "community_event_maybe",
  NOT_GOING: "community_event_not_going",
} as const;
export default function RsvpForm({ uid }: { uid: string }) {
  const { t } = useLocale();
  const router = useRouter();
  const [status, setStatus] = useState<keyof typeof choices>("GOING");
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<"success" | "error" | "full" | "rate" | "exists" | null>(null);
  const rsvpUids = useRef(new Map<string, string>());
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "")
      .trim()
      .toLowerCase();
    const storageKey = `community-event-rsvp:${uid}:${email}`;
    setPending(true);
    setFeedback(null);
    try {
      let savedUid = rsvpUids.current.get(storageKey);
      try {
        savedUid = localStorage.getItem(storageKey) ?? savedUid;
      } catch {}
      const response = await fetch(`/api/community-events/${encodeURIComponent(uid)}/rsvp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: form.get("name"),
          email,
          plusOnes: Number(form.get("plusOnes") || 0),
          status,
          rsvpUid: savedUid,
        }),
      });
      const result = await response.json();
      if (response.ok) {
        rsvpUids.current.set(storageKey, result.data.uid);
        try {
          localStorage.setItem(storageKey, result.data.uid);
        } catch {}
        setFeedback("success");
        router.refresh();
      } else if (response.status === 409) setFeedback(result.error === "RSVP_EXISTS" ? "exists" : "full");
      else if (response.status === 429) setFeedback("rate");
      else {
        setFeedback("error");
        router.refresh();
      }
    } catch {
      setFeedback("error");
    } finally {
      setPending(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-5 rounded-xl border border-subtle bg-default p-6">
      <fieldset disabled={pending} className="space-y-5">
        <legend className="mb-4 font-semibold text-xl">{t("community_event_rsvp")}</legend>
        <div className="flex flex-wrap gap-2">
          {(Object.keys(choices) as (keyof typeof choices)[]).map((choice) => (
            <Button
              key={choice}
              type="button"
              color={status === choice ? "primary" : "secondary"}
              aria-pressed={status === choice}
              onClick={() => setStatus(choice)}>
              {t(choices[choice])}
            </Button>
          ))}
        </div>
        <TextField name="name" label={t("community_event_name")} autoComplete="name" required />
        <TextField
          name="email"
          type="email"
          label={t("community_event_email")}
          autoComplete="email"
          required
        />
        <TextField
          name="plusOnes"
          type="number"
          label={t("community_event_plus_ones")}
          min={0}
          max={10}
          defaultValue={0}
        />
        <Button type="submit" disabled={pending} loading={pending}>
          {t("community_event_save")}
        </Button>
      </fieldset>
      {feedback && (
        <div role="status" aria-live="polite">
          <Alert
            severity={feedback === "success" ? "info" : "error"}
            message={t(`community_event_feedback_${feedback}`)}
          />
        </div>
      )}
    </form>
  );
}
