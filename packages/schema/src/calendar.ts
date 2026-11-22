import { z } from "zod";

/**
 * The calendar: her exams by date, and for each day what she studied. A day is her local calendar
 * day (YYYY-MM-DD); the app sends its offset from UTC so the server can sort moments into days.
 */

const Day = z.iso.date();

/** A lecture, folder or course she practised questions from, with how many answers were from it. */
export const CalendarTopic = z.object({
  nodeId: z.string(),
  name: z.string(),
  count: z.number().int().nonnegative(),
});
export type CalendarTopic = z.infer<typeof CalendarTopic>;

/** A lecture or document she wrote in herself that day. */
export const CalendarNote = z.object({
  nodeId: z.string(),
  title: z.string(),
  /** Blocks she added or changed in it that day. */
  edits: z.number().int().nonnegative(),
});
export type CalendarNote = z.infer<typeof CalendarNote>;

/** One day she studied. Days with nothing are left out. */
export const CalendarDay = z.object({
  date: Day,
  /** Questions answered, how many correctly, and the minutes spent answering. */
  answered: z.number().int().nonnegative(),
  correct: z.number().int().nonnegative(),
  minutes: z.number().int().nonnegative(),
  topics: z.array(CalendarTopic),
  notes: z.array(CalendarNote),
});
export type CalendarDay = z.infer<typeof CalendarDay>;

export const CalendarExam = z.object({
  id: z.string(),
  title: z.string(),
  date: Day,
  courseId: z.string(),
  courseName: z.string(),
});
export type CalendarExam = z.infer<typeof CalendarExam>;

export const CalendarResponse = z.object({
  from: Day,
  to: Day,
  today: Day,
  exams: z.array(CalendarExam),
  days: z.array(CalendarDay),
  /** Days in a row she has studied, ending today (or yesterday, if today has not started yet). */
  streak: z.number().int().nonnegative(),
});
export type CalendarResponse = z.infer<typeof CalendarResponse>;

/** The longest range one request may ask for, in days: a month with the weeks around it. */
export const CALENDAR_MAX_DAYS = 62;

/**
 * What a caller asks the calendar for: her local days from..to (at most CALENDAR_MAX_DAYS) and her
 * offset from UTC in minutes (e.g. -360 for US Central in winter; default 0). The web route and the
 * agent tool both read this.
 */
export const CalendarQuery = z.object({
  from: Day,
  to: Day,
  utcOffsetMinutes: z.coerce.number().int().min(-840).max(840).optional(),
});
export type CalendarQuery = z.infer<typeof CalendarQuery>;
