import { lazy, Suspense, useState } from "react";

// The blur entrance pulls in the animation library, so it loads after the first paint. Until then the
// heading is in the page (hidden, same size) so nothing shifts and the heading is always readable.
const BlurText = lazy(() => import("../../components/bits/BlurText"));

const HEADING = "mt-0.5 text-3xl font-semibold";

/**
 * The "Hello, Name" heading. Screen readers get the plain sentence; only the sighted view animates.
 * Once the entrance time has passed the plain heading takes over. That timer does not depend on
 * animation frames, so the heading can never stay invisible (a page loaded in the background draws none).
 */
export function GreetingTitle({ text }: { text: string }) {
  const [settled, setSettled] = useState(false);
  if (settled) return <h1 className={HEADING}>{text}</h1>;
  return (
    <Suspense fallback={<h1 className={`${HEADING} opacity-0`}>{text}</h1>}>
      <BlurText
        as="h1"
        text={text}
        trigger="load"
        delay={90}
        stepDuration={0.3}
        className={HEADING}
        onAnimationComplete={() => setSettled(true)}
      />
    </Suspense>
  );
}
