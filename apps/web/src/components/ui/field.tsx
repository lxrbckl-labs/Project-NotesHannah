import {
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
  useId,
} from "react";
import { cn } from "../../lib/cn";

export const inputClass =
  "min-h-11 w-full rounded-control border border-border-strong bg-surface px-3.5 text-body text-text placeholder:text-text-muted/80 focus-visible:outline-2 aria-invalid:border-danger xl:min-h-9 xl:text-ui";

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
      <label htmlFor={id} className="text-ui font-medium">
        {label}
      </label>
      {children({ id, "aria-describedby": describedBy, "aria-invalid": error ? true : undefined })}
      {error ? (
        <p id={`${id}-error`} className="text-ui text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-ui text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(inputClass, className)} {...props} />;
}

export function TextArea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea className={cn(inputClass, "min-h-24 py-2.5 leading-normal", className)} {...props} />
  );
}

/** The badge moved to ./badge; this keeps the old import path working. */
export { Badge } from "./badge";
