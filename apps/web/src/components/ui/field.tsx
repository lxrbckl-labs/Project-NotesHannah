import { type InputHTMLAttributes, type ReactNode, useId } from "react";
import { cn } from "../../lib/cn";

export const inputClass =
  "min-h-11 w-full rounded-xl border border-border-strong bg-surface px-3.5 text-base text-text placeholder:text-text-muted/80 focus-visible:outline-2 xl:min-h-9 xl:text-sm";

export function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: (props: {
    id: string;
    "aria-describedby"?: string;
    "aria-invalid"?: boolean;
  }) => ReactNode;
}) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-sm text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function Badge({
  tone = "neutral",
  children,
}: {
  tone?: "neutral" | "accent" | "danger";
  children: ReactNode;
}) {
  const tones = {
    neutral: "bg-surface-muted text-text-muted",
    accent: "bg-accent-soft text-accent",
    danger: "bg-danger-soft text-danger",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
        tones[tone],
      )}
    >
      {children}
    </span>
  );
}
