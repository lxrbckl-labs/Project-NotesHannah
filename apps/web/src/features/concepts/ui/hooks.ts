import { useCallback, useEffect, useRef, useState } from "react";

export type Async<T> =
  | { status: "loading"; data: null; error: null }
  | { status: "error"; data: null; error: unknown }
  | { status: "ready"; data: T; error: null };

/** Run an async read when `key` changes; keeps the last answer while reloading. */
export function useAsync<T>(run: () => Promise<T>, key: string): Async<T> & { reload: () => void } {
  const [state, setState] = useState<Async<T>>({ status: "loading", data: null, error: null });
  const [tick, setTick] = useState(0);
  const runRef = useRef(run);
  runRef.current = run;
  // biome-ignore lint/correctness/useExhaustiveDependencies: key and tick are the triggers
  useEffect(() => {
    let live = true;
    setState((s) => (s.status === "ready" ? s : { status: "loading", data: null, error: null }));
    runRef
      .current()
      .then((data) => live && setState({ status: "ready", data, error: null }))
      .catch((error) => live && setState({ status: "error", data: null, error }));
    return () => {
      live = false;
    };
  }, [key, tick]);
  const reload = useCallback(() => setTick((t) => t + 1), []);
  return { ...state, reload };
}

/** A value that settles after the user stops typing. */
export function useDebounced<T>(value: T, ms = 180): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return settled;
}
