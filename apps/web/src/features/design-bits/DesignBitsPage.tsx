import { Check } from "lucide-react";
import { lazy, type ReactNode, Suspense, useRef, useState } from "react";
import {
  AnimatedList,
  ClickSpark,
  type ClickSparkHandle,
  DotGrid,
  Magnet,
  ShinyText,
  SpotlightCard,
  StarBorder,
  Step,
  Stepper,
} from "../../components/bits";
import { Page } from "../../components/Page";

// These two import the animation library, so they load only when this page opens.
const CountUp = lazy(() => import("../../components/bits/CountUp"));
const BlurText = lazy(() => import("../../components/bits/BlurText"));

const BTN =
  "inline-flex min-h-11 items-center justify-center rounded-xl border border-border-strong bg-surface px-4 text-sm font-medium text-text hover:bg-surface-muted";

function Demo({
  name,
  use,
  note,
  children,
}: {
  name: string;
  use: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`bits-${name}`}
      className="rounded-3xl border border-border bg-surface p-4 shadow-card md:p-6"
    >
      <h2 id={`bits-${name}`} className="text-lg font-semibold">
        {name}
      </h2>
      <dl className="mt-1 grid gap-0.5 text-sm text-text-muted">
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-medium text-text">Use it for:</dt>
          <dd>{use}</dd>
        </div>
        <div className="flex gap-1.5">
          <dt className="shrink-0 font-medium text-text">Light and dark:</dt>
          <dd>{note}</dd>
        </div>
      </dl>
      <div className="mt-4">{children}</div>
    </section>
  );
}

const ACTIVITY = [
  { title: "Renal pharmacology", description: "Notes updated", meta: "2m" },
  { title: "Practice set finished", description: "18 of 20 correct", meta: "1h" },
  { title: "Cardiology flashcards", description: "12 cards due", meta: "3h" },
  { title: "Lecture slides added", description: "Week 7", meta: "1d" },
];

export function DesignBitsPage() {
  const [replay, setReplay] = useState(0);
  const [done, setDone] = useState(false);
  const spark = useRef<ClickSparkHandle>(null);

  return (
    <Page>
      <header className="dot-grid mb-6 rounded-3xl border border-border bg-surface px-5 py-5 md:px-8 md:py-7">
        <h1 className="text-3xl font-semibold">React Bits</h1>
        <p className="mt-1.5 max-w-prose text-sm text-text-muted">
          The small set of animated parts we copied in. Each one follows the colours of the theme
          and stands still when the device asks for less motion. Switch the theme to check both
          looks.
        </p>
      </header>

      <div className="grid gap-5">
        <Demo
          name="DotGrid"
          use="Behind the home headers and empty states, in place of the static dotted grid."
          note="Dots use the dot colour and light up in the accent colour. Redrawn when the theme changes."
        >
          <div className="relative h-56 overflow-hidden rounded-2xl border border-border bg-bg">
            <DotGrid dotSize={4} gap={20} />
            <p className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-text-muted">
              Move over the dots
            </p>
          </div>
        </Demo>

        <Demo
          name="SpotlightCard"
          use="Course and lecture cards in the library."
          note="Surface, border and shadow are the card tokens; the glow is the accent colour."
        >
          <div className="grid gap-4 md:grid-cols-2">
            <SpotlightCard className="p-5">
              <h3 className="font-semibold">Pharmacokinetics</h3>
              <p className="mt-1 text-sm text-text-muted">12 lectures, 3 exams</p>
            </SpotlightCard>
            <SpotlightCard className="p-5" shape="beam">
              <h3 className="font-semibold">Cardiology</h3>
              <p className="mt-1 text-sm text-text-muted">8 lectures, 1 exam</p>
            </SpotlightCard>
          </div>
        </Demo>

        <Demo
          name="CountUp"
          use="Stat tiles: cards due today, notebook size, practice score."
          note="Plain text colour from the class you give it. Shows the final number at once under reduced motion."
        >
          <div className="flex flex-wrap items-center gap-6">
            <Suspense fallback={<span className="text-4xl font-semibold opacity-0">128</span>}>
              <CountUp
                key={replay}
                to={128}
                trigger="load"
                duration={1.2}
                className="text-4xl font-semibold text-accent"
              />
              <CountUp
                key={`r${replay}`}
                to={9450}
                separator=","
                mode="roll"
                trigger="load"
                duration={1.4}
                className="text-4xl font-semibold"
              />
            </Suspense>
            <button type="button" className={BTN} onClick={() => setReplay((n) => n + 1)}>
              Replay
            </button>
          </div>
        </Demo>

        <Demo
          name="AnimatedList"
          use="The activity feed and the inbox."
          note="Frame, rows and selection ring use the surface, border and accent tokens."
        >
          <AnimatedList items={ACTIVITY} width="100%" maxHeight={300} animation="slide" />
        </Demo>

        <Demo
          name="BlurText"
          use="The greeting on the library home (already in use there)."
          note="Colour comes from the text class. The sentence stays one readable heading for screen readers."
        >
          <div className="flex flex-wrap items-center gap-4">
            <Suspense fallback={<p className="text-3xl font-semibold opacity-0">Hello, Hannah</p>}>
              <BlurText
                key={replay}
                as="h3"
                text="Hello, Hannah"
                trigger="load"
                className="text-3xl font-semibold"
              />
            </Suspense>
            <button type="button" className={BTN} onClick={() => setReplay((n) => n + 1)}>
              Replay
            </button>
          </div>
        </Demo>

        <Demo
          name="ClickSpark"
          use="A small burst when a practice answer is correct."
          note="Sparks are the accent colour. No sparks at all under reduced motion."
        >
          <ClickSpark ref={spark} sparkCount={10} sparkRadius={34} className="h-auto w-auto">
            <button
              type="button"
              className={BTN}
              onClick={() => {
                setDone(true);
                spark.current?.spark();
              }}
            >
              {done ? (
                <>
                  <Check size={16} aria-hidden="true" /> Correct
                </>
              ) : (
                "Mark answer correct"
              )}
            </button>
          </ClickSpark>
        </Demo>

        <Demo
          name="Stepper"
          use="Setup flows: adding a course, importing a lecture, starting an exam."
          note="Surfaces, text and the filled step use the tokens; the filled step is the accent colour."
        >
          <Stepper width="100%" completedContent={<p className="p-4 text-sm">All done.</p>}>
            <Step title="Pick a course">
              <p className="text-sm">Choose where the lecture belongs.</p>
            </Step>
            <Step title="Add files">
              <p className="text-sm">Drop slides, recordings or a PDF.</p>
            </Step>
            <Step title="Review">
              <p className="text-sm">Check the title, then finish.</p>
            </Step>
          </Stepper>
        </Demo>

        <Demo
          name="ShinyText"
          use="A quiet highlight on a status line, for example Syncing notes."
          note="Starts muted text colour and shines in the accent colour. Plain text under reduced motion."
        >
          <ShinyText text="Syncing your notes" className="text-lg font-medium" speed={3} />
        </Demo>

        <Demo
          name="StarBorder"
          use="The one main action on a screen, for example Start practice."
          note="Surface and text use the tokens; the travelling light is the accent colour."
        >
          <StarBorder as="button" type="button" duration={5}>
            Start practice
          </StarBorder>
        </Demo>

        <Demo
          name="Magnet"
          use="Small floating buttons on a computer screen. Never moves on touch."
          note="It has no colours of its own."
        >
          <Magnet padding={60} magnetStrength={4}>
            <button type="button" className={BTN}>
              Pull me
            </button>
          </Magnet>
        </Demo>
      </div>
    </Page>
  );
}
