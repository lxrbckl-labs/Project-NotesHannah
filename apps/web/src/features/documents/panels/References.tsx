import { citationKey } from "@notes/schema";
import { BookOpen } from "lucide-react";
import { cn } from "../../../lib/cn";
import { DOCUMENT_HUE } from "../../../lib/roles";
import { useActions, useView } from "../context";

/** The references list at the end of the document (K7): each source once, in order of first use. */
export function References({
  names,
}: {
  names: Map<string, { fileName: string | null; pageIndex: number | null }>;
}) {
  const { refs, status } = useView();
  const { openCitation } = useActions();
  if (refs.references.length === 0) return null;
  return (
    <section
      aria-labelledby="doc-references"
      className="mt-14 border-t border-border pt-6"
      data-testid="references"
    >
      <h2 id="doc-references" className="mb-3 flex items-center gap-2 text-[1.05rem] font-semibold">
        <BookOpen aria-hidden className="size-4.5 text-text-muted" />
        References
      </h2>
      <ol className="m-0 flex list-none flex-col gap-1 p-0">
        {refs.references.map((ref) => {
          const key = citationKey(ref.citation);
          const state = status.get(key) ?? "available";
          const meta = names.get(key);
          const unavailable = state !== "available";
          return (
            <li key={key}>
              <button
                type="button"
                data-testid="reference"
                onClick={() => openCitation(ref.number)}
                className="group flex w-full items-start gap-3 rounded-card px-2.5 py-2 text-left transition-colors duration-(--duration-instant) hover:bg-surface"
              >
                <span
                  data-hue={unavailable ? DOCUMENT_HUE.citationMissing : DOCUMENT_HUE.citation}
                  className={cn(
                    "mt-0.5 flex h-6 min-w-6 shrink-0 items-center justify-center rounded-pill border px-1 text-caption font-semibold text-tone-text tabular-nums",
                    unavailable
                      ? "border-dashed border-tone-solid"
                      : "border-tone-border bg-tone-soft",
                  )}
                >
                  {ref.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-ui leading-snug">“{ref.citation.quote}”</span>
                  <span className="mt-0.5 block text-label text-text-muted">
                    {unavailable
                      ? state === "source_trashed"
                        ? `Source in the trash${meta?.fileName ? ` · ${meta.fileName}` : ""}`
                        : "Source deleted"
                      : [
                          ref.citation.label,
                          meta?.fileName,
                          meta?.pageIndex ? `page ${meta.pageIndex}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                    {ref.uses.length > 1 ? ` · cited ${ref.uses.length} times` : ""}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
