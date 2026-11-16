import { lazy, Suspense } from "react";

// The blur entrance pulls in the animation library, so it loads after the first paint. Until then the
// heading is in the page (hidden, same size) so nothing shifts and the heading is always readable.
const BlurText = lazy(() => import("../../components/bits/BlurText"));

const HEADING = "mt-0.5 text-3xl font-semibold";

/** The "Hello, Name" heading. Screen readers get the plain sentence; only the sighted view animates. */
export function GreetingTitle({ text }: { text: string }) {
  return (
    <Suspense fallback={<h1 className={`${HEADING} opacity-0`}>{text}</h1>}>
      <BlurText
        as="h1"
        text={text}
        trigger="load"
        delay={90}
        stepDuration={0.3}
        className={HEADING}
      />
    </Suspense>
  );
}
