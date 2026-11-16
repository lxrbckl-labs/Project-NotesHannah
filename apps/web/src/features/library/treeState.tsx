import { createContext, type ReactNode, use, useCallback, useMemo, useRef, useState } from "react";

interface Stored {
  expanded: string[];
  scroll: number;
  /** False until the first-time default (terms open) has been applied. */
  seeded: boolean;
}

const key = (userId: string) => `notes-tree-v1:${userId}`;

function load(userId: string): Stored {
  try {
    const raw = localStorage.getItem(key(userId));
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Stored>;
      return {
        expanded: Array.isArray(parsed.expanded) ? parsed.expanded.map(String) : [],
        scroll: typeof parsed.scroll === "number" ? parsed.scroll : 0,
        seeded: parsed.seeded === true,
      };
    }
  } catch {
    // unreadable: start fresh
  }
  return { expanded: [], scroll: 0, seeded: false };
}

interface TreeStateApi {
  expanded: ReadonlySet<string>;
  toggle: (id: string, open?: boolean) => void;
  expandMany: (ids: Iterable<string>) => void;
  collapseAll: () => void;
  /** Apply the first-time default once. */
  seed: (ids: string[]) => void;
  getScroll: () => number;
  saveScroll: (top: number) => void;
}

const Context = createContext<TreeStateApi | null>(null);

export function useTreeState(): TreeStateApi {
  const value = use(Context);
  if (!value) throw new Error("useTreeState needs TreeStateProvider");
  return value;
}

/**
 * Which rows of the library tree are open, and how far the page is scrolled. Shared by the
 * sidebar and the library page, and kept in localStorage per person so it survives a reload.
 */
export function TreeStateProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [stored, setStored] = useState(() => load(userId));
  const scrollRef = useRef(stored.scroll);
  const storedRef = useRef(stored);
  storedRef.current = stored;

  const persist = useCallback(
    (next: Stored) => {
      storedRef.current = next;
      try {
        localStorage.setItem(key(userId), JSON.stringify(next));
      } catch {
        // storage unavailable: state lasts for this session only
      }
    },
    [userId],
  );

  const update = useCallback(
    (fn: (open: Set<string>) => void, seeded = true) => {
      const before = storedRef.current;
      const open = new Set(before.expanded);
      fn(open);
      const same =
        open.size === before.expanded.length && before.expanded.every((id) => open.has(id));
      if (same && before.seeded === seeded) return;
      const next = { ...storedRef.current, expanded: [...open], seeded, scroll: scrollRef.current };
      persist(next);
      setStored(next);
    },
    [persist],
  );

  const actions = useMemo(
    () => ({
      toggle: (id: string, open?: boolean) =>
        update((set) => {
          if (open ?? !set.has(id)) set.add(id);
          else set.delete(id);
        }),
      expandMany: (ids: Iterable<string>) =>
        update((set) => {
          for (const id of ids) set.add(id);
        }),
      collapseAll: () => update((set) => set.clear()),
      seed: (ids: string[]) => {
        if (storedRef.current.seeded) return;
        update((set) => {
          for (const id of ids) set.add(id);
        });
      },
      getScroll: () => storedRef.current.scroll,
      saveScroll: (top: number) => {
        scrollRef.current = top;
        persist({ ...storedRef.current, scroll: top });
      },
    }),
    [update, persist],
  );
  const expanded = useMemo(() => new Set(stored.expanded), [stored.expanded]);
  const api = useMemo<TreeStateApi>(() => ({ ...actions, expanded }), [actions, expanded]);

  return <Context value={api}>{children}</Context>;
}
