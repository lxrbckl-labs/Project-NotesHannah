import { Plus, X } from "lucide-react";
import { cn } from "../../lib/cn";
import type { TabsApi } from "./useTabs";

/**
 * Her open tabs, in a row under the search bar (tablet and computer). Shown once there is more than one;
 * a single page needs no strip. Each tab is a button to it and a button to close it.
 */
export function TabStrip({ tabs }: { tabs: TabsApi }) {
  return (
    <nav
      aria-label="Open tabs"
      data-testid="tab-strip"
      className="flex items-center gap-1 overflow-x-auto px-2 pb-2"
    >
      {tabs.tabs.map((tab) => {
        const current = tab.id === tabs.active;
        return (
          <div
            key={tab.id}
            data-testid="open-tab"
            data-current={current || undefined}
            className={cn(
              "group flex h-11 min-w-24 max-w-56 flex-1 items-center rounded-control border text-label transition-colors duration-(--duration-instant) xl:h-8",
              current
                ? "border-accent bg-accent-soft text-accent"
                : "border-border bg-surface text-text-muted hover:bg-surface-muted hover:text-text",
            )}
          >
            <button
              type="button"
              aria-current={current ? "page" : undefined}
              onClick={() => tabs.select(tab.id)}
              className="h-full min-w-0 flex-1 truncate rounded-control pl-3 pr-1 text-left font-medium"
            >
              {tab.title}
            </button>
            <button
              type="button"
              aria-label={`Close tab: ${tab.title}`}
              onClick={() => tabs.close(tab.id)}
              className="mr-1 flex size-9 shrink-0 items-center justify-center rounded-inline hover:bg-surface-muted hover:text-text xl:size-6"
            >
              <X size={14} aria-hidden />
            </button>
          </div>
        );
      })}
      <button
        type="button"
        aria-label="New tab"
        disabled={!tabs.canOpen}
        onClick={() => tabs.open()}
        className="flex size-11 shrink-0 items-center justify-center rounded-control text-text-muted hover:bg-surface-muted hover:text-text disabled:pointer-events-none disabled:opacity-50 xl:size-8"
      >
        <Plus size={16} aria-hidden />
      </button>
    </nav>
  );
}
