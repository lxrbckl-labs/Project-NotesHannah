import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import {
  type CSSProperties,
  createContext,
  type ReactNode,
  use,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router";
import { Button } from "../../components/ui/button";
import { TOUR_STEPS, type TourStep } from "./steps";
import "./tour.css";

interface TourApi {
  /** Start the tour from its first stop. */
  start: () => void;
  running: boolean;
}

const Context = createContext<TourApi>({ start: () => {}, running: false });

/** Start the tour from anywhere (the guide's button). */
export function useTour(): TourApi {
  return use(Context);
}

interface Box {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** The first of a stop's targets that is really on screen, if any. */
function findTarget(step: TourStep): HTMLElement | null {
  for (const selector of step.target ?? []) {
    let found: HTMLElement | null = null;
    try {
      // `:has-text()` is not CSS: a selector written with it names a button by its words.
      const words = selector.match(/^(.*):has-text\("(.*)"\)$/);
      if (words) {
        const [, base = "*", text = ""] = words;
        found =
          [...document.querySelectorAll<HTMLElement>(base)].find((el) =>
            (el.textContent ?? "").includes(text),
          ) ?? null;
      } else {
        found = document.querySelector<HTMLElement>(selector);
      }
    } catch {
      found = null;
    }
    if (!found) continue;
    const r = found.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < window.innerHeight) return found;
  }
  return null;
}

const PAD = 6;
const CARD_WIDTH = 340;

/** Where the card sits: beside the lit thing where there is room, otherwise under or over it. */
function placeCard(box: Box | null, card: { width: number; height: number }): CSSProperties {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const gap = 14;
  const clampX = (x: number) => Math.max(12, Math.min(vw - card.width - 12, x));
  // Leave the bottom right for the Skip button.
  const clampY = (y: number) => Math.max(12, Math.min(vh - card.height - 76, y));
  if (!box) return { left: clampX((vw - card.width) / 2), top: clampY((vh - card.height) / 2) };
  const right = box.left + box.width + gap;
  if (right + card.width <= vw - 12) return { left: right, top: clampY(box.top) };
  const below = box.top + box.height + gap;
  if (below + card.height <= vh - 76) return { left: clampX(box.left), top: below };
  const above = box.top - gap - card.height;
  if (above >= 12) return { left: clampX(box.left), top: above };
  return { left: clampX(box.left - gap - card.width), top: clampY(box.top) };
}

/**
 * Provides the tour to the app and draws it while it runs: the page dims, a spotlight glides to the
 * part being explained, and a small card says what it is for. Next and Back move between stops, the
 * arrow keys do the same, and Skip (bottom right) or Escape ends it. `onEnd` is told once, however it
 * ends, so the app can remember that she has seen it.
 */
export function TourProvider({ children, onEnd }: { children: ReactNode; onEnd?: () => void }) {
  const [index, setIndex] = useState<number | null>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const [box, setBox] = useState<Box | null>(null);
  const [ready, setReady] = useState(false);
  const card = useRef<HTMLDivElement>(null);
  const [cardStyle, setCardStyle] = useState<CSSProperties>({});
  const step = index === null ? null : (TOUR_STEPS[index] ?? null);
  const ended = useRef(onEnd);
  ended.current = onEnd;

  const start = useCallback(() => setIndex(0), []);
  const end = useCallback(() => {
    setIndex(null);
    setBox(null);
    ended.current?.();
  }, []);
  const go = useCallback(
    (by: number) =>
      setIndex((i) => {
        if (i === null) return i;
        const next = i + by;
        if (next < 0) return i;
        if (next >= TOUR_STEPS.length) {
          queueMicrotask(end);
          return i;
        }
        return next;
      }),
    [end],
  );

  // Go to the stop's page.
  useEffect(() => {
    if (step && location.pathname !== step.route) navigate(step.route);
  }, [step, location.pathname, navigate]);

  // Find the thing to light, and keep the spotlight on it while the page settles, scrolls or resizes.
  useEffect(() => {
    if (!step) return;
    setReady(false);
    let frame = 0;
    let tries = 0;
    let last = "";
    const measure = () => {
      frame = requestAnimationFrame(measure);
      if (location.pathname !== step.route) return;
      const el = findTarget(step);
      if (!el) {
        // Give a page that is still loading a moment before settling for the middle of the screen.
        if (!step.target || ++tries > 45) {
          if (last !== "none") {
            last = "none";
            setBox(null);
            setReady(true);
          }
        }
        return;
      }
      const r = el.getBoundingClientRect();
      const next: Box = {
        left: Math.round(r.left - PAD),
        top: Math.round(r.top - PAD),
        width: Math.round(r.width + PAD * 2),
        height: Math.round(r.height + PAD * 2),
      };
      const key = `${next.left},${next.top},${next.width},${next.height}`;
      if (key !== last) {
        last = key;
        setBox(next);
        setReady(true);
      }
    };
    frame = requestAnimationFrame(measure);
    return () => cancelAnimationFrame(frame);
  }, [step, location.pathname]);

  // Place the card once its size is known.
  // biome-ignore lint/correctness/useExhaustiveDependencies: place again whenever the stop or the lit box changes
  useLayoutEffect(() => {
    const el = card.current;
    if (!el || !step) return;
    setCardStyle(placeCard(box, { width: el.offsetWidth, height: el.offsetHeight }));
  }, [box, step, ready]);

  // Keys: Escape ends, the arrows move.
  useEffect(() => {
    if (!step) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        end();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        go(1);
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        go(-1);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [step, end, go]);

  const last = index !== null && index === TOUR_STEPS.length - 1;
  return (
    <Context value={{ start, running: step !== null }}>
      {children}
      {step && index !== null
        ? createPortal(
            <div className="tour-root" data-testid="tour" data-step={step.id}>
              {/* Catches every tap and click, so nothing under the tour is pressed by accident. */}
              <div className="tour-shield" aria-hidden />
              {/* The spotlight: a clear window whose huge shadow is the dimmed page. Without a target it
                  shrinks to nothing in the middle, and the whole page is dimmed. */}
              <div
                aria-hidden
                className="tour-spot"
                data-empty={box ? undefined : "true"}
                style={
                  box
                    ? { left: box.left, top: box.top, width: box.width, height: box.height }
                    : { left: "50%", top: "50%", width: 0, height: 0 }
                }
              />
              <div
                ref={card}
                role="dialog"
                aria-modal="true"
                aria-labelledby="tour-title"
                aria-describedby="tour-text"
                data-testid="tour-card"
                data-ready={ready}
                className="tour-card"
                style={{ ...cardStyle, width: `min(${CARD_WIDTH}px, calc(100vw - 24px))` }}
              >
                <p className="text-caption font-semibold tracking-wide text-text-muted uppercase">
                  {index + 1} of {TOUR_STEPS.length}
                </p>
                <h2 id="tour-title" className="mt-1 font-display text-title font-semibold">
                  {step.title}
                </h2>
                <p id="tour-text" className="mt-1.5 text-ui leading-relaxed text-text-muted">
                  {step.text}
                </p>
                <div className="mt-4 flex items-center gap-2">
                  {/* Where she is in the tour. */}
                  <div aria-hidden className="flex flex-1 gap-1">
                    {TOUR_STEPS.map((s, i) => (
                      <span key={s.id} className="tour-dot" data-on={i === index || undefined} />
                    ))}
                  </div>
                  {index > 0 ? (
                    <Button size="sm" onClick={() => go(-1)} data-testid="tour-back">
                      <ArrowLeft size={15} aria-hidden />
                      Back
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => go(1)}
                    data-testid="tour-next"
                    autoFocus
                  >
                    {last ? "Done" : "Next"}
                    {last ? <Check size={15} aria-hidden /> : <ArrowRight size={15} aria-hidden />}
                  </Button>
                </div>
              </div>
              {/* Always in the same place, whatever the stop: the bottom right. */}
              <button type="button" className="tour-skip" onClick={end} data-testid="tour-skip">
                Skip tour
              </button>
            </div>,
            document.body,
          )
        : null}
    </Context>
  );
}
