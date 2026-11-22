import type { CalendarDay, CalendarExam, CalendarResponse } from "@notes/schema";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Flame,
  GraduationCap,
  NotebookPen,
  PenLine,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { HeaderArt } from "../../components/art/pills";
import { Page } from "../../components/Page";
import { Badge } from "../../components/ui/badge";
import { Button, buttonClass, IconButton } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { StatTile } from "../../components/ui/stat";
import { ErrorState } from "../../components/ui/states";
import { appHttp } from "../../lib/api";
import { cn } from "../../lib/cn";
import {
  addDays,
  addMonths,
  dayKey,
  longDay,
  monthGrid,
  monthKey,
  monthTitle,
  relativeDay,
  studyLevel,
  WEEKDAYS,
} from "./dates";
import "./calendar.css";

/** On a phone the three figures share one row: less padding and a smaller number. */
const TILE = "max-sm:p-2.5 max-sm:[&>div:nth-child(2)]:text-title";

const offset = () => -new Date().getTimezoneOffset();

function useCalendar(from: string, to: string) {
  return useQuery({
    queryKey: ["calendar", from, to],
    queryFn: () =>
      appHttp.get<CalendarResponse>("/calendar", { from, to, utcOffsetMinutes: offset() }),
    placeholderData: keepPreviousData,
  });
}

/** The month at a glance: exams on their dates, the days she studied, and what she did on each. */
export function CalendarPage() {
  const today = dayKey(new Date());
  const [month, setMonth] = useState(() => monthKey(new Date()));
  const [picked, setPicked] = useState(today);
  const weeks = useMemo(() => monthGrid(month), [month]);
  const from = weeks[0]?.[0]?.key ?? today;
  const to = weeks[weeks.length - 1]?.[6]?.key ?? today;
  const shown = useCalendar(from, to);
  // What is coming, whatever month is on screen.
  const ahead = useCalendar(today, addDays(today, 60));

  const days = useMemo(
    () => new Map((shown.data?.days ?? []).map((d) => [d.date, d])),
    [shown.data],
  );
  const exams = useMemo(() => {
    const map = new Map<string, CalendarExam[]>();
    for (const e of shown.data?.exams ?? []) map.set(e.date, [...(map.get(e.date) ?? []), e]);
    return map;
  }, [shown.data]);

  const studiedThisMonth = [...days.keys()].filter((d) => d.slice(0, 7) === month).length;
  const next = ahead.data?.exams[0];
  const streak = ahead.data?.streak ?? shown.data?.streak ?? 0;

  const go = (by: number) => {
    const target = addMonths(month, by);
    setMonth(target);
    // Keep a day selected in the month on screen.
    setPicked(target === today.slice(0, 7) ? today : `${target}-01`);
  };

  return (
    <Page>
      <PageHeader
        title="Calendar"
        description="Your exams on their dates, and the days you studied."
        art={<HeaderArt kind="calendar" />}
      />

      <div className="cal-stats mb-5 grid grid-cols-3 gap-2 sm:gap-3">
        <StatTile
          className={TILE}
          label="Next exam"
          value={next ? relativeDay(today, next.date) : "None set"}
          hint={next ? next.title : "Add one from Practice, Exams."}
          icon={<CalendarClock />}
          hue="orange"
        />
        <StatTile
          className={TILE}
          label="Streak"
          value={`${streak} ${streak === 1 ? "day" : "days"}`}
          hint={streak > 0 ? "in a row" : "Study today to start one."}
          icon={<Flame />}
          hue="red"
        />
        <StatTile
          className={TILE}
          label="Studied"
          value={`${studiedThisMonth} ${studiedThisMonth === 1 ? "day" : "days"}`}
          hint={`in ${monthTitle(month)}`}
          icon={<GraduationCap />}
          hue="teal"
        />
      </div>

      {/* What is coming sits above the month, right under the three figures (Alex, 2026-11-21). */}
      <Upcoming
        today={today}
        exams={ahead.data?.exams ?? []}
        onPick={(date) => {
          setMonth(date.slice(0, 7));
          setPicked(date);
        }}
      />

      {shown.isError ? (
        <ErrorState error={shown.error} onRetry={() => shown.refetch()} />
      ) : (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem]">
          <Card as="section" padding="sm" aria-label={monthTitle(month)}>
            <div className="mb-2 flex items-center gap-2 px-1">
              <h2 className="min-w-0 flex-1 truncate font-display text-title font-semibold">
                {monthTitle(month)}
              </h2>
              <Button
                onClick={() => {
                  setMonth(today.slice(0, 7));
                  setPicked(today);
                }}
              >
                Today
              </Button>
              <IconButton aria-label="Previous month" onClick={() => go(-1)}>
                <ChevronLeft size={20} />
              </IconButton>
              <IconButton aria-label="Next month" onClick={() => go(1)}>
                <ChevronRight size={20} />
              </IconButton>
            </div>

            <div
              aria-busy={shown.isFetching}
              // The month slides in a little each time it changes (calendar.css).
              key={month}
              className="cal-month"
            >
              <div className="grid grid-cols-7">
                {WEEKDAYS.map((w) => (
                  <div
                    key={w}
                    aria-hidden
                    className="pb-1 text-center text-caption font-semibold tracking-wide text-text-muted uppercase"
                  >
                    {w}
                  </div>
                ))}
              </div>
              {weeks.map((week) => (
                <div key={week[0]?.key} className="grid grid-cols-7 gap-1 pb-1">
                  {week.map(({ key, inMonth }) => (
                    <DayCell
                      key={key}
                      date={key}
                      inMonth={inMonth}
                      today={key === today}
                      picked={key === picked}
                      day={days.get(key)}
                      exams={exams.get(key) ?? []}
                      onPick={() => setPicked(key)}
                    />
                  ))}
                </div>
              ))}
            </div>

            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 px-1 text-caption text-text-muted">
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="size-2.5 rounded-pill bg-hue-orange-solid" /> Exam
              </span>
              <span className="flex items-center gap-1.5">
                <span aria-hidden className="flex gap-0.5">
                  <span className="cal-level size-2.5 rounded-inline" data-level="1" />
                  <span className="cal-level size-2.5 rounded-inline" data-level="2" />
                  <span className="cal-level size-2.5 rounded-inline" data-level="3" />
                </span>
                Studied: a little, some, a lot
              </span>
            </div>
          </Card>

          <DayDetail
            date={picked}
            today={today}
            day={days.get(picked)}
            exams={exams.get(picked) ?? []}
          />
        </div>
      )}
    </Page>
  );
}

function DayCell({
  date,
  inMonth,
  today,
  picked,
  day,
  exams,
  onPick,
}: {
  date: string;
  inMonth: boolean;
  today: boolean;
  picked: boolean;
  day: CalendarDay | undefined;
  exams: CalendarExam[];
  onPick: () => void;
}) {
  const level = studyLevel(day);
  const words = [
    longDay(date),
    today ? "today" : "",
    exams.length > 0 ? `${exams.length} ${exams.length === 1 ? "exam" : "exams"}` : "",
    level > 0 ? "studied" : "",
  ]
    .filter(Boolean)
    .join(", ");
  return (
    <div>
      <button
        type="button"
        onClick={onPick}
        aria-label={words}
        aria-pressed={picked}
        data-testid="cal-day"
        data-date={date}
        data-level={level}
        data-today={today || undefined}
        className={cn(
          "cal-day cal-level flex h-16 w-full flex-col items-stretch gap-0.5 rounded-control border p-1 text-left transition-colors duration-(--duration-instant) md:h-24 md:p-1.5",
          picked
            ? "border-accent ring-2 ring-accent/30"
            : "border-border hover:border-border-strong",
          !inMonth && "opacity-45",
        )}
      >
        <span className="flex items-center justify-between gap-1">
          <span
            className={cn(
              "flex size-6 items-center justify-center rounded-pill text-label font-semibold tabular-nums",
              today ? "bg-accent text-accent-contrast" : "text-text",
            )}
          >
            {Number(date.slice(8))}
          </span>
          {level > 0 ? (
            <span aria-hidden className="text-accent">
              <PenLine size={12} />
            </span>
          ) : null}
        </span>
        {/* A phone has room for a dot; from tablet width up the exam's name fits. */}
        {exams.length > 0 ? (
          <>
            <span aria-hidden className="flex gap-0.5 md:hidden">
              {exams.slice(0, 3).map((e) => (
                <span key={e.id} className="size-2 rounded-pill bg-hue-orange-solid" />
              ))}
            </span>
            <span aria-hidden className="hidden min-w-0 flex-col gap-0.5 md:flex">
              {exams.slice(0, 2).map((e) => (
                <span
                  key={e.id}
                  className="truncate rounded-inline bg-hue-orange-soft px-1 text-caption font-medium text-hue-orange-text"
                >
                  {e.title}
                </span>
              ))}
              {exams.length > 2 ? (
                <span className="text-caption text-text-muted">+{exams.length - 2} more</span>
              ) : null}
            </span>
          </>
        ) : null}
      </button>
    </div>
  );
}

function DayDetail({
  date,
  today,
  day,
  exams,
}: {
  date: string;
  today: string;
  day: CalendarDay | undefined;
  exams: CalendarExam[];
}) {
  const future = date > today;
  const accuracy = day && day.answered > 0 ? Math.round((day.correct / day.answered) * 100) : null;
  return (
    <Card
      as="aside"
      aria-label="The day you picked"
      data-testid="cal-detail"
      key={date}
      className="cal-detail"
    >
      <p className="text-label font-medium text-text-muted capitalize">
        {relativeDay(today, date)}
      </p>
      <h2 className="font-display text-title font-semibold">{longDay(date)}</h2>

      {exams.length > 0 ? (
        <section className="mt-4">
          <h3 className="mb-1.5 text-caption font-semibold tracking-wide text-text-muted uppercase">
            {exams.length === 1 ? "Exam" : "Exams"}
          </h3>
          <ul className="grid gap-2">
            {exams.map((e) => (
              <li
                key={e.id}
                data-hue="orange"
                className="rounded-control border border-tone-border bg-tone-soft px-3 py-2"
              >
                <p className="font-medium text-tone-text">{e.title}</p>
                {e.courseName ? (
                  <p className="text-caption text-text-muted">{e.courseName}</p>
                ) : null}
              </li>
            ))}
          </ul>
          <Link to="/exams" className={cn(buttonClass({ variant: "secondary" }), "mt-2")}>
            <GraduationCap size={16} aria-hidden /> Open the exam plan
          </Link>
        </section>
      ) : null}

      <section className="mt-4">
        <h3 className="mb-1.5 text-caption font-semibold tracking-wide text-text-muted uppercase">
          {future ? "Study" : "What you studied"}
        </h3>
        {!day ? (
          <p className="text-ui text-text-muted">
            {future
              ? "Nothing here yet. Come back after you study."
              : date === today
                ? "Nothing yet today."
                : "No study recorded on this day."}
          </p>
        ) : (
          <div className="grid gap-3">
            {day.answered > 0 ? (
              <div>
                <p className="flex items-center gap-2 text-ui">
                  <GraduationCap size={16} aria-hidden className="shrink-0 text-accent" />
                  <span>
                    <strong className="font-semibold">{day.answered}</strong>{" "}
                    {day.answered === 1 ? "question" : "questions"}
                    {accuracy !== null ? `, ${accuracy}% correct` : ""}
                    {day.minutes > 0 ? `, about ${day.minutes} min` : ""}
                  </span>
                </p>
                {day.topics.length > 0 ? (
                  <ul className="mt-1.5 flex flex-wrap gap-1.5">
                    {day.topics.slice(0, 8).map((t) => (
                      <li key={t.nodeId}>
                        <Link to={`/library/${t.nodeId}`} className="rounded-pill">
                          <Badge hue="teal">
                            {t.name} · {t.count}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : null}
            {day.notes.length > 0 ? (
              <div>
                <p className="flex items-center gap-2 text-ui">
                  <NotebookPen size={16} aria-hidden className="shrink-0 text-accent" />
                  <span>
                    Wrote in <strong className="font-semibold">{day.notes.length}</strong>{" "}
                    {day.notes.length === 1 ? "note" : "notes"}
                  </span>
                </p>
                <ul className="mt-1.5 grid gap-1">
                  {day.notes.slice(0, 8).map((n) => (
                    <li
                      key={n.nodeId}
                      className="flex items-baseline justify-between gap-2 text-ui"
                    >
                      <Link
                        to={`/doc/${n.nodeId}`}
                        className="min-w-0 truncate text-accent underline-offset-2 hover:underline"
                      >
                        {n.title}
                      </Link>
                      <span className="shrink-0 text-caption text-text-muted">
                        {n.edits} {n.edits === 1 ? "change" : "changes"}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        )}
      </section>
    </Card>
  );
}

function Upcoming({
  today,
  exams,
  onPick,
}: {
  today: string;
  exams: CalendarExam[];
  onPick: (date: string) => void;
}) {
  if (exams.length === 0) return null;
  return (
    <section aria-labelledby="cal-upcoming" className="mb-6">
      <h2 id="cal-upcoming" className="mb-3 font-display text-title font-semibold">
        Coming up
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {exams.slice(0, 6).map((e) => (
          <li key={e.id}>
            <button
              type="button"
              onClick={() => onPick(e.date)}
              className="flex w-full items-center gap-3 rounded-card border border-border bg-surface p-3 text-left shadow-card transition-colors duration-(--duration-instant) hover:border-border-strong"
            >
              <span
                data-hue="orange"
                className="flex size-12 shrink-0 flex-col items-center justify-center rounded-control bg-tone-soft text-tone-text"
              >
                <span className="text-caption font-semibold uppercase leading-none">
                  {new Date(`${e.date}T12:00:00`).toLocaleDateString(undefined, { month: "short" })}
                </span>
                <span className="font-display text-title font-semibold leading-tight tabular-nums">
                  {Number(e.date.slice(8))}
                </span>
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{e.title}</span>
                <span className="block truncate text-caption text-text-muted">
                  {e.courseName ? `${e.courseName} · ` : ""}
                  {relativeDay(today, e.date)}
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
