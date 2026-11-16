import { Switch as RadixSwitch } from "radix-ui";
import { useId } from "react";
import { cn } from "../../lib/cn";

/**
 * An on/off setting with its label. The whole row is the 44px touch target; the label is
 * clickable and the switch is announced with its name and state.
 */
export function Switch({
  label,
  description,
  checked,
  onCheckedChange,
  disabled,
  className,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={cn("flex min-h-11 items-center gap-3", className)}>
      <div className="min-w-0 flex-1">
        <label htmlFor={id} className="text-ui font-medium">
          {label}
        </label>
        {description ? (
          <p id={`${id}-description`} className="text-label text-text-muted">
            {description}
          </p>
        ) : null}
      </div>
      <RadixSwitch.Root
        id={id}
        checked={checked}
        onCheckedChange={onCheckedChange}
        disabled={disabled}
        aria-describedby={description ? `${id}-description` : undefined}
        className="hit-area relative inline-flex h-7 w-12 shrink-0 items-center rounded-pill border border-border-strong bg-surface-muted transition-colors duration-(--duration-fast) disabled:opacity-50 data-[state=checked]:border-transparent data-[state=checked]:bg-accent"
      >
        <RadixSwitch.Thumb className="block size-5 translate-x-1 rounded-pill bg-surface shadow-card transition-transform duration-(--duration-fast) ease-calm data-[state=checked]:translate-x-6" />
      </RadixSwitch.Root>
    </div>
  );
}
