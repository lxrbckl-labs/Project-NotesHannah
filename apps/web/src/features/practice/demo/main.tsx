/**
 * Standalone demo page for development, Playwright and screenshots. Not part of the app build.
 * Query: ?theme=light|dark  ?fresh=1 (forget saved state)  ?empty=1 (no history)
 *        ?now=2026-11-15T10:00:00 (fixed clock)  ?bar=0 (hide the demo bar)
 */
import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import "../../../app/styles.css";
import { Dialog } from "radix-ui";
import type { PickedNode, PickNodes } from "../../exams/types";
import { PracticeApp } from "../PracticeApp";
import { NODE_L7, NODES } from "../store/bank";
import { createMockStore } from "../store/mock";
import type { SourceCitation } from "../types";
import { Button } from "../ui/primitives";

const params = new URLSearchParams(window.location.search);
const STORAGE_KEY = "notes-practice-demo";

// ?fresh=1 forgets saved state once per browser tab, so a reload afterwards still resumes.
if (params.get("fresh") === "1") {
  try {
    if (!sessionStorage.getItem("demo-fresh-done")) {
      localStorage.removeItem(STORAGE_KEY);
      sessionStorage.setItem("demo-fresh-done", "1");
    }
  } catch {
    // storage unavailable: nothing to forget
  }
}
const theme = params.get("theme");
if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;

const base = params.get("now") ? Date.parse(params.get("now") as string) : null;
let ticks = 0;
const store = createMockStore({
  start: params.get("empty") === "1" ? "empty" : "demo",
  storage: (() => {
    try {
      return localStorage;
    } catch {
      return null;
    }
  })(),
  storageKey: STORAGE_KEY,
  now: base === null ? () => new Date() : () => new Date(base + ticks++ * 1000),
});

declare global {
  interface Window {
    __practice: {
      store: typeof store;
      /** The answer key for the question on screen (test support). */
      key: () => unknown;
      opened: SourceCitation[];
    };
  }
}
window.__practice = {
  store,
  opened: [],
  key() {
    const el = document.querySelector<HTMLElement>('[data-testid="player"]');
    if (!el) return null;
    return store.debugKey(el.dataset.session as string, Number(el.dataset.index));
  },
};

function Demo() {
  const [opened, setOpened] = useState<SourceCitation | null>(null);
  const [picker, setPicker] = useState<{
    selected: string[];
    resolve: (n: PickedNode[] | null) => void;
  } | null>(null);
  const [theme2, setTheme] = useState<string>(document.documentElement.dataset.theme ?? "system");
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (theme2 === "system") delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = theme2;
  }, [theme2]);

  const pickNodes: PickNodes = ({ selected }) =>
    new Promise((resolve) => setPicker({ selected: [...selected], resolve }));

  return (
    <div className="min-h-dvh bg-bg text-text">
      {params.get("bar") !== "0" && !active && (
        <div
          className="flex items-center justify-between gap-2 border-b border-border px-4 py-2 text-xs text-text-muted"
          data-demo-bar
        >
          <span>Practice demo (mock data)</span>
          <span className="flex gap-1">
            {["light", "dark", "system"].map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={theme2 === t}
                onClick={() => setTheme(t)}
                className="min-h-8 rounded-full px-3 aria-pressed:bg-accent aria-pressed:text-accent-contrast"
              >
                {t}
              </button>
            ))}
            <button
              type="button"
              className="min-h-8 rounded-full px-3"
              onClick={() => {
                store.reset();
                window.location.reload();
              }}
            >
              reset
            </button>
          </span>
        </div>
      )}
      <PracticeApp
        store={store}
        currentNodeId={NODE_L7}
        pickNodes={pickNodes}
        onActiveChange={setActive}
        onOpenSource={(c) => {
          window.__practice.opened.push(c);
          setOpened(c);
        }}
      />
      {opened && (
        <div
          role="status"
          data-testid="source-opened"
          className="pr-card fixed inset-x-4 bottom-4 z-[80] mx-auto max-w-md p-4 text-sm"
        >
          <p className="font-medium">Would open: {opened.label ?? "source"}</p>
          <p className="mt-1 text-text-muted">&ldquo;{opened.quote}&rdquo;</p>
          <Button className="mt-2" size="sm" onClick={() => setOpened(null)}>
            Close
          </Button>
        </div>
      )}
      <NodePicker picker={picker} onDone={() => setPicker(null)} />
    </div>
  );
}

function NodePicker({
  picker,
  onDone,
}: {
  picker: { selected: string[]; resolve: (n: PickedNode[] | null) => void } | null;
  onDone: () => void;
}) {
  const [sel, setSel] = useState<string[]>([]);
  useEffect(() => {
    if (picker) setSel(picker.selected);
  }, [picker]);
  const finish = (value: PickedNode[] | null) => {
    picker?.resolve(value);
    onDone();
  };
  return (
    <Dialog.Root open={picker !== null} onOpenChange={(o) => !o && finish(null)}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/40" />
        <Dialog.Content
          aria-describedby={undefined}
          className="pr-root pr-card fixed inset-x-4 top-1/2 z-[91] mx-auto max-w-md -translate-y-1/2 space-y-4 p-6"
        >
          <Dialog.Title className="text-lg font-semibold">Choose lectures or folders</Dialog.Title>
          <ul className="space-y-2">
            {NODES.map((n) => (
              <li key={n.id}>
                <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-border px-3">
                  <input
                    type="checkbox"
                    className="size-5 accent-[var(--color-accent)]"
                    checked={sel.includes(n.id)}
                    onChange={() =>
                      setSel(sel.includes(n.id) ? sel.filter((x) => x !== n.id) : [...sel, n.id])
                    }
                  />
                  <span>{n.title}</span>
                </label>
              </li>
            ))}
          </ul>
          <div className="flex justify-end gap-2">
            <Button variant="quiet" onClick={() => finish(null)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              data-testid="picker-done"
              onClick={() =>
                finish(
                  NODES.filter((n) => sel.includes(n.id)).map(({ id, title, path }) => ({
                    id,
                    title,
                    path,
                  })),
                )
              }
            >
              Use these
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <StrictMode>
    <Demo />
  </StrictMode>,
);
