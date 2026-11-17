import { PillMark } from "../../components/art/pills";
import { cn } from "../../lib/cn";
import { QUICK_REFERENCE, type Showcase } from "./content";
import { Inline, SHOWCASE_LOOK } from "./GuideBlocks";

/** The app's mark: the green square with the notebook, as in the sidebar. */
export function AppMark({ className, size = 18 }: { className?: string; size?: number }) {
  return (
    <span
      aria-hidden
      className={cn(
        "gb-mark flex shrink-0 items-center justify-center rounded-control bg-accent text-accent-contrast",
        className,
      )}
    >
      <PillMark size={size} />
    </span>
  );
}

/** One "what makes this different" card: an icon, the claim, and why it matters. */
export function ShowcaseCard({
  item,
  index,
  featured,
}: {
  item: Showcase;
  index: number;
  featured?: boolean;
}) {
  const look = SHOWCASE_LOOK[index] ?? SHOWCASE_LOOK[0];
  const Icon = look?.icon;
  return (
    <li
      data-hue={look?.hue}
      data-featured={featured ? "true" : undefined}
      className={cn(
        "gb-card guide-card flex flex-col rounded-card border border-border bg-surface p-4 shadow-card md:p-5",
        featured && "sm:col-span-2",
      )}
    >
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="gb-card-icon flex size-9 shrink-0 items-center justify-center rounded-control bg-tone-soft text-tone-text"
        >
          {Icon ? <Icon size={18} /> : null}
        </span>
        <h3 className="gb-card-title font-display text-title leading-snug font-semibold">
          {item.title}
        </h3>
      </div>
      <p className="gb-card-what mt-3 text-ui text-text">{item.what}</p>
      <p className="gb-card-why mt-auto border-t border-border pt-3 text-ui text-text-muted [p+&]:mt-3">
        <span className="gb-card-why-label mb-0.5 block text-caption font-semibold tracking-wide text-tone-text uppercase">
          Why it matters
        </span>
        {item.why}
      </p>
    </li>
  );
}

/** The quick reference: every shortcut, mark and key, in four groups. */
export function QuickReferenceCard() {
  return (
    <div className="gb-qr grid gap-x-8 gap-y-6 rounded-panel border border-border bg-surface p-5 shadow-card md:grid-cols-2 md:p-6">
      {QUICK_REFERENCE.map((group) => (
        <section key={group.title} className="gb-qr-group min-w-0" aria-label={group.title}>
          <h3 className="gb-qr-title font-display text-body font-semibold text-accent">
            {group.title}
          </h3>
          {group.note ? (
            <p className="gb-qr-note mt-0.5 text-caption text-text-muted">{group.note}</p>
          ) : null}
          <dl className="mt-2 grid grid-cols-[minmax(0,auto)_1fr] gap-x-4 text-ui">
            {group.rows.map(([keys, what]) => (
              <div
                key={`${keys}-${what}`}
                className="gb-qr-row col-span-2 grid grid-cols-subgrid items-baseline border-t border-border py-1.5 first:border-t-0"
              >
                <dt className="gb-qr-keys">
                  <Inline text={keys ?? ""} />
                </dt>
                <dd className="text-text-muted">{what}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </div>
  );
}
