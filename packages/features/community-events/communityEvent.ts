import { z } from "zod";

export const eventInput = z.object({
  title: z.string().trim().min(1),
  slug: z.string().trim().min(1).optional(),
  description: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  coverImageUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//i.test(value), "Cover images must use HTTP or HTTPS")
    .nullable()
    .optional(),
  startTime: z.date(),
  endTime: z.date(),
  timeZone: z.string().refine((value) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Invalid time zone"),
  location: z.string().nullable().optional(),
  capacity: z.number().int().min(1).nullable().optional(),
  hidden: z.boolean().optional(),
  showAttendees: z.boolean().optional(),
});
export const rsvpInput = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
  status: z.enum(["GOING", "MAYBE", "NOT_GOING"]),
  plusOnes: z.number().int().min(0).max(10).default(0),
  note: z.string().nullable().optional(),
});
export type EventInput = z.infer<typeof eventInput>;
export type RsvpInput = z.infer<typeof rsvpInput>;
