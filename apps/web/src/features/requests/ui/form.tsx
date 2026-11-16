import { REQUEST_KIND_INFO, type RequestKind, type RequestTarget } from "@notes/schema";
import { Lightbulb } from "lucide-react";
import { useId } from "react";
import { Chip } from "../../../components/ui/badge";
import { inputClass } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";
import { EXAMPLES_FOR_TARGET, KINDS_FOR_TARGET, kindLabel } from "../model/wording";

/** Quick actions as a single-choice set of toggle buttons. Tapping the chosen one again clears it (free text only). */
export function KindPicker({
  targetType,
  value,
  onChange,
}: {
  targetType: RequestTarget["type"];
  value: RequestKind | null;
  onChange: (kind: RequestKind | null) => void;
}) {
  return (
    <fieldset className="m-0 min-w-0 border-0 p-0">
      <legend className="mb-2 p-0 text-ui font-medium">Quick ask</legend>
      <div className="flex flex-wrap gap-2">
        {KINDS_FOR_TARGET[targetType].map((kind) => {
          const checked = value === kind;
          return (
            <Chip
              key={kind}
              pressed={checked}
              title={REQUEST_KIND_INFO[kind].meaning}
              data-testid={`kind-${kind}`}
              onClick={() => onChange(checked ? null : kind)}
              className="min-h-9 px-4 text-ui"
            >
              {kindLabel(kind)}
            </Chip>
          );
        })}
      </div>
    </fieldset>
  );
}

export function MessageBox({
  value,
  onChange,
  required,
  label,
  placeholder,
  autoFocus,
  maxLength = 4000,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  label: string;
  placeholder?: string;
  autoFocus?: boolean;
  maxLength?: number;
  hint?: string;
}) {
  const id = useId();
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-ui font-medium">
        {label}
        {required ? null : <span className="font-normal text-text-muted"> (optional)</span>}
      </label>
      <textarea
        id={id}
        data-testid="message"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={4}
        maxLength={maxLength}
        // biome-ignore lint/a11y/noAutofocus: the dialog opens to type in it
        autoFocus={autoFocus}
        aria-describedby={hint ? `${id}-hint` : undefined}
        className={cn(inputClass, "min-h-28 resize-y py-3 leading-relaxed")}
      />
      {hint ? (
        <p id={`${id}-hint`} className="text-ui text-text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

/** Ideas that teach what a request can be; tapping one fills the box. */
export function Examples({
  targetType,
  onPick,
}: {
  targetType: RequestTarget["type"];
  onPick: (text: string) => void;
}) {
  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-ui font-medium">
        <Lightbulb size={15} aria-hidden className="text-accent" />
        Ideas, tap one to use it
      </p>
      <ul className="grid gap-2">
        {EXAMPLES_FOR_TARGET[targetType].map((text) => (
          <li key={text}>
            <button
              type="button"
              data-testid="example"
              onClick={() => onPick(text)}
              className="min-h-11 w-full rounded-control border border-border bg-surface-muted/60 px-3.5 py-2 text-left text-ui text-text transition-colors duration-(--duration-instant) hover:bg-surface-muted"
            >
              {text}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
