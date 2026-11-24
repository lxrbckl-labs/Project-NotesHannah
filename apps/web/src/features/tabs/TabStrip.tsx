import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { cn } from "../../lib/cn";
import type { TabsApi } from "./useTabs";

/**
 * Her open tabs, inside the header bar (app/AppShell), from two tabs on. They take the room the search
 * gives up and scroll sideways when there are more than fit; the one on screen is kept in view. Each tab is
 * a button to it and a button to close it.
 */
export function TabStrip({ tabs }: { tabs: TabsApi }) {
  const current = useRef<HTMLDivElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: when another tab comes on screen, or one is added
  useEffect(() => {
    current.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tabs.active, tabs.tabs.length]);
  return (
    <nav
      aria-label="Open tabs"
      data-testid="tab-strip"
      className="tab-strip flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto"
    >
      {tabs.tabs.map((tab) => {
        const isCurrent = tab.id === tabs.active;
        return (
          <div
            key={tab.id}
            ref={isCurrent ? current : undefined}
            data-testid="open-tab"
            data-current={isCurrent || undefined}
            className={cn(
              // They share the room: wide (up to 24rem) while there are few, narrower only as more are opened, and
              // never under 9rem; past that the strip scrolls.
              "flex h-11 min-w-36 max-w-96 flex-1 basis-0 items-center rounded-control text-label transition-colors duration-(--duration-instant) xl:h-8",
              isCurrent
                ? "bg-accent-soft text-accent"
                : // The lighter gray fill: every tab is a visible place to click, not bare text in the bar.
                  "bg-surface-muted text-text-muted hover:bg-hue-gray-mark hover:text-text",
            )}
          >
            <button
              type="button"
              aria-current={isCurrent ? "page" : undefined}
              onClick={() => tabs.select(tab.id)}
              className="h-full min-w-0 flex-1 truncate rounded-control pl-3 pr-1 text-left font-medium"
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close tab: ${tab.title}`}
              onClick={() => tabs.close(tab.id)}
              className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-inline hover:bg-surface hover:text-text xl:size-6"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
    </nav>
  );
}
