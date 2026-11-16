import { useEffect, useRef } from "react";
import ClickSpark, { type ClickSparkHandle } from "../../../components/bits/ClickSpark";

/** One small burst from the middle of the box it sits in, fired as soon as it mounts. */
export default function SparkBurst() {
  const ref = useRef<ClickSparkHandle>(null);
  useEffect(() => {
    ref.current?.spark();
  }, []);
  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <ClickSpark ref={ref} sparkCount={8} sparkRadius={26} sparkSize={9} duration={600} />
    </span>
  );
}
