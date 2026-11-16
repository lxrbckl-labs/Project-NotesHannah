import { lazy, Suspense, useEffect, useState } from "react";

// The count-up loads the animation library on first use, so the Practice home paints first.
const CountUp = lazy(() => import("../../../components/bits/CountUp"));

const SETTLE_MS = 1500;

/**
 * A stat number that counts up once. The real value sits in an sr-only span (and carries the test id),
 * so screen readers and tests see the final number at once; only the visible copy animates.
 * After a fixed time the plain number takes over, so a stalled animation (a page loaded in the
 * background draws no frames) can never leave a wrong number on screen.
 */
export function StatNumber({ value, testId }: { value: number; testId: string }) {
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    const timer = window.setTimeout(() => setSettled(true), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, []);
  return (
    <>
      <span className="sr-only" data-testid={testId}>
        {value}
      </span>
      <span aria-hidden="true">
        {settled ? (
          value
        ) : (
          <Suspense fallback={<span className="opacity-0">{value}</span>}>
            <CountUp to={value} duration={0.9} trigger="load" />
          </Suspense>
        )}
      </span>
    </>
  );
}
