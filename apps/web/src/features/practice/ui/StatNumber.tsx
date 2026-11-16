import { lazy, Suspense } from "react";

// The count-up loads the animation library on first use, so the Practice home paints first.
const CountUp = lazy(() => import("../../../components/bits/CountUp"));

/**
 * A stat number that counts up once. The real value sits in an sr-only span (and carries the test id),
 * so screen readers and tests see the final number at once; only the visible copy animates.
 */
export function StatNumber({ value, testId }: { value: number; testId: string }) {
  return (
    <>
      <span className="sr-only" data-testid={testId}>
        {value}
      </span>
      <span aria-hidden="true">
        <Suspense fallback={<span className="opacity-0">{value}</span>}>
          <CountUp to={value} duration={0.9} trigger="load" />
        </Suspense>
      </span>
    </>
  );
}
