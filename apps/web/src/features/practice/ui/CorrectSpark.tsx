import { lazy, Suspense } from "react";

// The spark library loads on the first correct answer, so a session starts without it.
const SparkBurst = lazy(() => import("./SparkBurst"));

/**
 * A small touch on a correct answer. Place it inside a `relative` box (the verdict icon); the burst
 * starts from the middle of that box. It draws only on top of an already complete screen: nothing
 * waits for it, it stays still under reduced motion, and without canvas it renders nothing.
 */
export function CorrectSpark() {
  if (
    typeof window === "undefined" ||
    typeof window.matchMedia !== "function" ||
    typeof CanvasRenderingContext2D === "undefined"
  )
    return null;
  return (
    <Suspense fallback={null}>
      <SparkBurst />
    </Suspense>
  );
}
