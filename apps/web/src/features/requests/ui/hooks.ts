import type { RequestCounts, RequestStatus } from "@notes/schema";
import { useCallback, useEffect, useRef, useState } from "react";
import { badgeCount, type Filter, filterStatuses, pollDelay, readSeen } from "../model/wording";
import type { RequestsStore, StudyRequestWithContext } from "../types";

export interface RequestsState {
  items: StudyRequestWithContext[] | null;
  counts: RequestCounts | null;
  error: unknown;
  /** Look again now, quietly. */
  refresh: () => Promise<void>;
}

/**
 * Her requests for one filter, newest first, with the counts. Looks again by itself while an
 * agent is working (every few seconds) or while requests wait (slowly); stops when nothing is open.
 */
export function useRequests(store: RequestsStore, filter: Filter): RequestsState {
  const [items, setItems] = useState<StudyRequestWithContext[] | null>(null);
  const [counts, setCounts] = useState<RequestCounts | null>(null);
  const [error, setError] = useState<unknown>(null);
  const alive = useRef(true);
  const latest = useRef(0);

  const refresh = useCallback(async () => {
    const ticket = ++latest.current;
    try {
      const status = filterStatuses(filter);
      const [page, nextCounts] = await Promise.all([
        store.list({ order: "newest", ...(status ? { status } : {}) }),
        store.counts(),
      ]);
      if (!alive.current || ticket !== latest.current) return;
      setItems(page.items);
      setCounts(nextCounts);
      setError(null);
    } catch (caught) {
      if (!alive.current || ticket !== latest.current) return;
      setError(caught);
    }
  }, [store, filter]);

  useEffect(() => {
    alive.current = true;
    setItems(null);
    setError(null);
    void refresh();
    return () => {
      alive.current = false;
    };
  }, [refresh]);

  const open: RequestStatus[] = [];
  if (counts && counts.in_progress > 0) open.push("in_progress");
  else if (counts && counts.waiting > 0) open.push("waiting");
  const delay = pollDelay(open);
  useEffect(() => {
    if (delay === null) return;
    const timer = setInterval(() => void refresh(), delay);
    return () => clearInterval(timer);
  }, [delay, refresh]);

  return { items, counts, error, refresh };
}

/**
 * The number for a badge on the Requests entry: requests still waiting plus answers she has not
 * opened yet. Shells call this with the same store they give the Requests screen.
 */
export function useRequestsBadge(store: RequestsStore, options: { pollMs?: number } = {}): number {
  const [count, setCount] = useState(0);
  const pollMs = options.pollMs ?? 60_000;
  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const [counts, done] = await Promise.all([
          store.counts(),
          store.list({ status: ["done", "declined"], order: "newest", limit: 50 }),
        ]);
        if (alive) setCount(badgeCount(counts.waiting, done.items, readSeen()));
      } catch {
        // a badge is never worth an error
      }
    }
    void load();
    const timer = setInterval(() => void load(), pollMs);
    const onSeen = () => void load();
    window.addEventListener("notes-requests-seen", onSeen);
    return () => {
      alive = false;
      clearInterval(timer);
      window.removeEventListener("notes-requests-seen", onSeen);
    };
  }, [store, pollMs]);
  return count;
}
