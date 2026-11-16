import { useEffect, useState } from "react";

/**
 * The id of the section being read: the last one whose top has passed a line a little below the
 * top of the screen. The app scrolls inside <main id="main">; the print page scrolls the window.
 */
export function useActiveSection(ids: string[], offset = 140): string | undefined {
  const [active, setActive] = useState<string | undefined>(ids[0]);
  const key = ids.join(" ");

  // biome-ignore lint/correctness/useExhaustiveDependencies: ids are compared by their joined key
  useEffect(() => {
    const main = document.getElementById("main");
    const target: HTMLElement | Window = main ?? window;
    let frame = 0;
    const measure = () => {
      frame = 0;
      const top = main ? main.getBoundingClientRect().top : 0;
      let current = ids[0];
      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - top <= offset) current = id;
        else break;
      }
      // At the very end, the last section counts as read even if its top never reached the line.
      const scroller = main ?? document.scrollingElement;
      if (scroller && scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) {
        current = ids[ids.length - 1];
      }
      setActive(current);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    measure();
    target.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      target.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [key, offset]);

  return active;
}
