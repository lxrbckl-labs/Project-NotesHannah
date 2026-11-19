import { useEffect, useRef } from "react";
import { useLocation, useNavigationType } from "react-router";

/** The class on anything that takes her back a level: a back arrow. See `backButtonClass`. */
export const NAV_BACK_CLASS = "nav-back";

/**
 * Pages slide like cards in a stack. Opening something brings the new page in from the right;
 * going back (a back arrow in the app, or the browser's own Back) brings the page she left for in
 * from the left. Only the main area moves, the sidebars stay still.
 *
 * - A back arrow in the app is an ordinary link to the parent, so it is recognised by its class
 *   (a click on `.nav-back` just before the page changes), not by the kind of navigation.
 * - Nothing slides when only the query or the anchor changes, when the address is replaced, or while
 *   the phone's tab bar is running its own slide.
 * - The animation is a class on #main for its length, never a wrapper (a box around the page changes
 *   what full-height screens measure against). Reduced motion turns it off in styles.css.
 */
export function usePageSlide(): void {
  const location = useLocation();
  const type = useNavigationType();
  const last = useRef(location.pathname);
  const backClick = useRef(0);

  useEffect(() => {
    const onClick = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(`.${NAV_BACK_CLASS}`)) {
        backClick.current = Date.now();
      }
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    if (last.current === location.pathname) return;
    last.current = location.pathname;
    const main = document.getElementById("main");
    if (!main || document.documentElement.classList.contains("tab-sliding")) return;
    const wentBack = type === "POP" || Date.now() - backClick.current < 800;
    backClick.current = 0;
    if (type === "REPLACE" && !wentBack) return;
    // Restart the animation even if the last one is still running.
    delete main.dataset.slide;
    void main.offsetWidth;
    main.dataset.slide = wentBack ? "back" : "forward";
    const done = () => delete main.dataset.slide;
    main.addEventListener("animationend", done, { once: true });
    return () => main.removeEventListener("animationend", done);
  }, [location.pathname, type]);
}
