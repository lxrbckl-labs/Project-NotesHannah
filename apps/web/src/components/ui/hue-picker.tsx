import { Check } from "lucide-react";
import { RadioGroup } from "radix-ui";
import { cn } from "../../lib/cn";
import { HUE_LABEL, HUES, type Hue } from "../../lib/hues";

const NONE = "none";

/**
 * Pick a colour from the palette (card, frame, course, highlighter). Each swatch is a radio with
 * the colour's name, so it works without seeing the colour. Arrow keys move between swatches.
 */
export function HuePicker({
  label,
  value,
  onChange,
  hues = HUES,
  allowNone = true,
  noneLabel = "No colour",
  className,
}: {
  /** The accessible name of the group, e.g. "Card colour". */
  label: string;
  value: Hue | null;
  onChange: (hue: Hue | null) => void;
  hues?: readonly Hue[];
  allowNone?: boolean;
  noneLabel?: string;
  className?: string;
}) {
  return (
    <RadioGroup.Root
      aria-label={label}
      value={value ?? NONE}
      onValueChange={(next) => onChange(next === NONE ? null : (next as Hue))}
      orientation="horizontal"
      className={cn("flex flex-wrap gap-1", className)}
    >
      {allowNone ? (
        <RadioGroup.Item
          value={NONE}
          aria-label={noneLabel}
          className="group flex size-11 items-center justify-center rounded-pill xl:size-9"
        >
          <span className="flex size-7 items-center justify-center rounded-pill border-2 border-border-strong bg-surface group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-text group-data-[state=checked]:ring-offset-2 group-data-[state=checked]:ring-offset-surface">
            <span aria-hidden className="h-0.5 w-4 rotate-45 rounded-pill bg-border-strong" />
          </span>
        </RadioGroup.Item>
      ) : null}
      {hues.map((hue) => (
        <RadioGroup.Item
          key={hue}
          value={hue}
          aria-label={HUE_LABEL[hue]}
          data-hue={hue}
          className="group flex size-11 items-center justify-center rounded-pill xl:size-9"
        >
          <span className="flex size-7 items-center justify-center rounded-pill border-2 border-tone-solid bg-tone-soft group-data-[state=checked]:ring-2 group-data-[state=checked]:ring-text group-data-[state=checked]:ring-offset-2 group-data-[state=checked]:ring-offset-surface">
            <RadioGroup.Indicator>
              <Check size={14} strokeWidth={3} aria-hidden className="text-tone-text" />
            </RadioGroup.Indicator>
          </span>
        </RadioGroup.Item>
      ))}
    </RadioGroup.Root>
  );
}
