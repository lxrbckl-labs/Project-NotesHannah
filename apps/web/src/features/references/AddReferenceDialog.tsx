import { type ReferenceAttribution, webAddressProblem } from "@notes/schema";
import { BookMarked } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Field, TextInput } from "../../components/ui/field";
import { ErrorState, LoadingList } from "../../components/ui/states";
import { useReferences } from "./queries";
import { suggestFromUrl } from "./ReferenceForm";
import { hostOf } from "./ReferenceItem";

/**
 * "Add a reference" on a block: pick one of her saved references, or paste an address. The block
 * then shows the reference as its own chip, apart from her sources.
 */
export function AddReferenceDialog({
  open,
  onOpenChange,
  onPick,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (reference: ReferenceAttribution) => void;
}) {
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      sheet="touch"
      title="Add a reference"
      description="Show where this block draws on an outside reference. It gets its own label, apart from your sources."
    >
      {open ? <Body onPick={onPick} /> : null}
    </Modal>
  );
}

function Body({ onPick }: { onPick: (reference: ReferenceAttribution) => void }) {
  const saved = useReferences();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(event: FormEvent) {
    event.preventDefault();
    const problem = webAddressProblem(url.trim());
    if (problem) return setError(problem);
    const name = title.trim() || suggestFromUrl(url)?.title || hostOf(url);
    onPick({ title: name.slice(0, 200), url: new URL(url.trim()).href });
  }

  return (
    <div className="grid gap-5">
      <section aria-labelledby="pick-saved">
        <h3 id="pick-saved" className="mb-2 text-ui font-semibold">
          Your saved references
        </h3>
        {saved.isPending ? (
          <LoadingList rows={2} label="Loading references" />
        ) : saved.isError ? (
          <ErrorState error={saved.error} onRetry={() => saved.refetch()} />
        ) : saved.data.length === 0 ? (
          <p className="text-ui text-text-muted">None saved yet. Paste an address below.</p>
        ) : (
          <ul className="grid max-h-64 gap-1.5 overflow-y-auto" aria-label="Pick a saved reference">
            {saved.data.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  onClick={() => onPick({ title: r.title, url: r.url, referenceId: r.id })}
                  className="flex min-h-11 w-full items-center gap-2.5 rounded-card border border-border bg-bg px-3 py-1.5 text-left hover:border-border-strong hover:bg-surface-muted"
                >
                  <BookMarked size={16} aria-hidden className="shrink-0 text-text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate text-ui font-medium">{r.title}</span>
                    <span className="block truncate text-caption text-text-muted">
                      {hostOf(r.url)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
      <form onSubmit={submit} className="grid gap-3 border-t border-border pt-4" noValidate>
        <h3 className="text-ui font-semibold">Or paste an address</h3>
        <Field label="Web address" error={error}>
          {(p) => (
            <TextInput
              {...p}
              type="url"
              inputMode="url"
              placeholder="https://"
              value={url}
              onChange={(e) => {
                setUrl(e.target.value);
                setError(null);
              }}
            />
          )}
        </Field>
        <Field label="Label (optional)">
          {(p) => <TextInput {...p} value={title} onChange={(e) => setTitle(e.target.value)} />}
        </Field>
        <div className="flex justify-end">
          <Button type="submit" variant="primary">
            Add this reference
          </Button>
        </div>
      </form>
    </div>
  );
}
