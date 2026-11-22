import type { SavedInstruction } from "@notes/schema";
import { ScrollText } from "lucide-react";
import { createContext, type ReactNode, use, useId } from "react";
import { inputClass } from "../../../components/ui/field";
import { cn } from "../../../lib/cn";

/**
 * Her saved instructions, for the request dialog: standing rules for a kind of work ("how I want
 * lecture notes built"), written once in Settings and chosen here. This module does not know where
 * they are kept; the app hands them in through this context. With none handed in, the dialog simply
 * has no picker.
 */
interface InstructionsValue {
  list: readonly SavedInstruction[];
  /** Opens the place where she adds and changes them (Settings). */
  onManage?: (() => void) | undefined;
}

const Context = createContext<InstructionsValue>({ list: [] });

export function InstructionsProvider({
  list,
  onManage,
  children,
}: InstructionsValue & { children: ReactNode }) {
  return <Context value={{ list, onManage }}>{children}</Context>;
}

export function useSavedInstructions(): InstructionsValue {
  return use(Context);
}

const NONE = "";

/** The dropdown of saved instructions, with the chosen one's words shown underneath. */
export function InstructionPicker({
  value,
  onChange,
  onManage,
  list,
}: {
  /** The chosen instruction's id, or null for none. */
  value: string | null;
  onChange: (id: string | null) => void;
  onManage?: (() => void) | undefined;
  list: readonly SavedInstruction[];
}) {
  const id = useId();
  const chosen = list.find((i) => i.id === value) ?? null;
  return (
    <div className="grid gap-1.5" data-testid="instruction-picker">
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={id} className="text-ui font-medium">
          Instructions
          <span className="font-normal text-text-muted"> (optional)</span>
        </label>
        {onManage ? (
          <button
            type="button"
            onClick={onManage}
            className="rounded-inline text-label font-medium text-accent underline-offset-2 hover:underline"
          >
            {list.length === 0 ? "Write one in Settings" : "Manage"}
          </button>
        ) : null}
      </div>
      {list.length === 0 ? (
        <p className="rounded-control border border-dashed border-border-strong px-3 py-2.5 text-ui text-text-muted">
          Save how you like your notes built, once, and pick it here each time.
        </p>
      ) : (
        <>
          <select
            id={id}
            data-testid="instruction-select"
            value={value ?? NONE}
            onChange={(event) => onChange(event.target.value === NONE ? null : event.target.value)}
            className={cn(inputClass, "appearance-auto")}
          >
            <option value={NONE}>No instructions</option>
            {list.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title}
              </option>
            ))}
          </select>
          {chosen ? (
            <div
              data-testid="instruction-preview"
              className="flex gap-2.5 rounded-control bg-surface-muted px-3 py-2.5 text-ui"
            >
              <ScrollText size={16} aria-hidden className="mt-0.5 shrink-0 text-text-muted" />
              <p className="max-h-32 min-w-0 overflow-y-auto whitespace-pre-wrap text-text-muted [overflow-wrap:anywhere]">
                {chosen.body}
              </p>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
