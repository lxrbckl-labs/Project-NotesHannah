import { cn } from "../../lib/cn";

/**
 * One line that gives up its middle, not its end: "Cholinergic ag…ents 02". CSS can only cut the
 * end, so the last few characters are held back in their own span. Short text is left whole.
 */
export function MiddleTruncate({
  text,
  tail = 7,
  className,
}: {
  text: string;
  tail?: number;
  className?: string;
}) {
  if (text.length <= tail * 3) {
    return <span className={cn("block min-w-0 truncate", className)}>{text}</span>;
  }
  const head = text.slice(0, text.length - tail);
  return (
    <span className={cn("flex min-w-0", className)}>
      <span className="sr-only">{text}</span>
      <span aria-hidden className="min-w-0 truncate">
        {head}
      </span>
      <span aria-hidden className="shrink-0 whitespace-pre">
        {text.slice(-tail)}
      </span>
    </span>
  );
}
