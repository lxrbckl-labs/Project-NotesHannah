import { CircleAlert, CircleCheck } from "lucide-react";
import { createContext, type ReactNode, use, useCallback, useMemo, useState } from "react";
import { describeError } from "../../lib/api";
import { Button } from "./button";

interface ToastItem {
  id: number;
  tone: "info" | "error";
  message: string;
  hint?: string;
  action?: { label: string; run: () => void };
}

interface ToastApi {
  show: (message: string, action?: ToastItem["action"]) => void;
  error: (error: unknown) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const value = use(ToastContext);
  if (!value) throw new Error("useToast needs a ToastProvider");
  return value;
}

let counter = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);

  const dismiss = useCallback(
    (id: number) => setItems((all) => all.filter((t) => t.id !== id)),
    [],
  );
  const push = useCallback(
    (item: Omit<ToastItem, "id">, ms: number) => {
      const id = ++counter;
      setItems((all) => [...all.slice(-2), { ...item, id }]);
      setTimeout(() => dismiss(id), ms);
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      show: (message, action) => push({ tone: "info", message, action }, action ? 7000 : 4000),
      error: (error) => push({ tone: "error", ...describeError(error) }, 9000),
    }),
    [push],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        aria-live="polite"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(5.5rem+env(safe-area-inset-bottom))] z-[60] flex flex-col items-center gap-2 px-4 md:bottom-6"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.tone === "error" ? "alert" : "status"}
            className="anim-pop pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-2xl border border-border bg-surface p-3.5 text-sm shadow-pop"
          >
            {t.tone === "error" ? (
              <CircleAlert size={18} className="mt-0.5 shrink-0 text-danger" aria-hidden />
            ) : (
              <CircleCheck size={18} className="mt-0.5 shrink-0 text-accent" aria-hidden />
            )}
            <div className="min-w-0 flex-1">
              <p className="font-medium">{t.message}</p>
              {t.hint ? <p className="mt-0.5 text-text-muted">{t.hint}</p> : null}
            </div>
            {t.action ? (
              <Button
                variant="ghostAccent"
                className="-my-1.5 -mr-1.5"
                onClick={() => {
                  t.action?.run();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </Button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext>
  );
}
