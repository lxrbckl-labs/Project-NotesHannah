import type { ReactNode } from "react";
import { cn } from "../lib/cn";

/** The padded, centered column every screen sits in. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-5xl px-4 pb-10 pt-4 md:px-8 md:pt-8", className)}>
      {children}
    </div>
  );
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h2 className="text-base font-semibold text-text">{children}</h2>
      {action}
    </div>
  );
}
