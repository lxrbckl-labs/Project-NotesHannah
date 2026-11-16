import {
  REFERENCE_KIND_LABEL,
  REFERENCE_KINDS,
  REFERENCE_LIMITS,
  type ReferenceKind,
  type SavedReference,
  webAddressProblem,
} from "@notes/schema";
import { MapPin, X } from "lucide-react";
import { type FormEvent, useId, useState } from "react";
import { Badge, Chip } from "../../components/ui/badge";
import { Button, IconButton } from "../../components/ui/button";
import { Modal } from "../../components/ui/dialog";
import { Field, TextArea, TextInput } from "../../components/ui/field";
import { Switch } from "../../components/ui/switch";
import { useToast } from "../../components/ui/toast";
import { describeError } from "../../lib/api";
import { usePickNodes } from "../library/pickNodes";
import { useReferenceMutations } from "./queries";
import { resourceForUrl } from "./registry";

export interface FormPlace {
  nodeId: string;
  name: string;
  path: string;
}

/** What the form opens with: an existing reference to edit, or a fresh one (maybe tied to a place). */
export type FormSubject =
  | { mode: "edit"; reference: SavedReference }
  | { mode: "new"; places?: FormPlace[] };

/** "antibioticdex" -> "Antibioticdex"; "high-blood_pressure" -> "High blood pressure". */
function humanise(segment: string): string {
  const words = decodeURIComponent(segment)
    .replace(/\.[a-z0-9]{2,5}$/i, "")
    .replace(/[-_+]+/g, " ")
    .trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

/**
 * A first guess at a title and kind from a pasted address, so saving a page she likes is one paste
 * and one tap. The site's own section names come from the registry; anything else from the address.
 */
export function suggestFromUrl(url: string): { title: string; kind: ReferenceKind | null } | null {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  const site = resourceForUrl(parsed.href);
  if (site) {
    const part = site.parts.find((p) => new URL(p.href).pathname === parsed.pathname);
    const KIND_BY_PATH: Record<string, ReferenceKind> = {
      "/categories/": "guideline",
      "/antibioticdex/": "chart",
      "/dosedex/": "chart",
      "/tnkalc/": "calculator",
    };
    const last = parsed.pathname.split("/").filter(Boolean).at(-1);
    const label = part?.label ?? (last ? humanise(last) : "");
    return {
      title: label ? `${site.name}: ${label}` : site.name,
      kind: KIND_BY_PATH[parsed.pathname] ?? (part ? null : "guideline"),
    };
  }
  const host = parsed.hostname.replace(/^www\./, "");
  const last = parsed.pathname.split("/").filter(Boolean).at(-1);
  return { title: last ? `${humanise(last)} (${host})` : host, kind: null };
}

/** Save or edit one reference: address first (a paste fills the title), then title, kind, note, places, pin. */
export function ReferenceForm({
  subject,
  onClose,
}: {
  subject: FormSubject | null;
  onClose: () => void;
}) {
  return (
    <Modal
      open={!!subject}
      onOpenChange={(open) => !open && onClose()}
      sheet="touch"
      title={subject?.mode === "edit" ? "Edit reference" : "Save a reference"}
      description="A page you rely on, with a note in your own words."
      hideDescription
    >
      {subject ? (
        <FormBody
          key={subject.mode === "edit" ? subject.reference.id : "new"}
          subject={subject}
          onClose={onClose}
        />
      ) : null}
    </Modal>
  );
}

function FormBody({ subject, onClose }: { subject: FormSubject; onClose: () => void }) {
  const editing = subject.mode === "edit" ? subject.reference : null;
  const [url, setUrl] = useState(editing?.url ?? "");
  const [title, setTitle] = useState(editing?.title ?? "");
  const [titleTouched, setTitleTouched] = useState(!!editing);
  const [kind, setKind] = useState<ReferenceKind | null>(editing?.kind ?? null);
  const [note, setNote] = useState(editing?.note ?? "");
  const [favourite, setFavourite] = useState(editing?.favourite ?? false);
  const [places, setPlaces] = useState<FormPlace[]>(
    editing
      ? editing.places
          .filter((p) => !p.trashed)
          .map((p) => ({ nodeId: p.nodeId, name: p.name, path: p.path }))
      : subject.mode === "new"
        ? (subject.places ?? [])
        : [],
  );
  const [urlError, setUrlError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const pick = usePickNodes();
  const mutations = useReferenceMutations();
  const toast = useToast();
  const kindLabel = useId();
  const busy = mutations.create.isPending || mutations.update.isPending;
  const site = webAddressProblem(url.trim()) === null ? resourceForUrl(url.trim()) : undefined;

  function suggest(value: string) {
    const guess = suggestFromUrl(value);
    if (!guess) return;
    if (!titleTouched) setTitle(guess.title.slice(0, REFERENCE_LIMITS.titleChars));
    if (kind === null && guess.kind) setKind(guess.kind);
  }

  async function choosePlaces() {
    const chosen = await pick({
      selected: places.map((p) => p.nodeId),
      title: "Where it belongs",
      pick: "places",
      allowNone: true,
    });
    if (!chosen) return;
    const known = new Map(places.map((p) => [p.nodeId, p]));
    setPlaces(chosen.map((c) => known.get(c.id) ?? { nodeId: c.id, name: c.title, path: c.path }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setFormError(null);
    const problem = webAddressProblem(url.trim());
    setUrlError(problem);
    setTitleError(title.trim() ? null : "Give it a title");
    if (problem || !title.trim()) return;
    const input = {
      title: title.trim(),
      url: url.trim(),
      note: note.trim(),
      kind,
      nodeIds: places.map((p) => p.nodeId),
      favourite,
    };
    try {
      if (editing) {
        await mutations.update.mutateAsync({ id: editing.id, input });
        toast.success("Reference saved");
      } else {
        await mutations.create.mutateAsync(input);
        toast.success("Reference saved");
      }
      onClose();
    } catch (error) {
      const { message, hint } = describeError(error);
      setFormError(hint ? `${message} ${hint}` : message);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <Field
        label="Web address"
        hint="Paste the address of the page. Only http and https addresses."
        error={urlError}
      >
        {(p) => (
          <TextInput
            {...p}
            type="url"
            inputMode="url"
            autoComplete="off"
            placeholder="https://"
            value={url}
            maxLength={REFERENCE_LIMITS.urlChars}
            onChange={(e) => {
              setUrl(e.target.value);
              setUrlError(null);
            }}
            onPaste={(e) => suggest(e.clipboardData.getData("text"))}
            onBlur={() => suggest(url)}
          />
        )}
      </Field>
      {site ? (
        <p className="-mt-2 flex flex-wrap items-center gap-2 text-ui text-text-muted">
          <Badge tone="info">From {site.name}</Badge>
          It will be tagged as from {site.name}.
        </p>
      ) : null}
      <Field label="Title" error={titleError}>
        {(p) => (
          <TextInput
            {...p}
            value={title}
            maxLength={REFERENCE_LIMITS.titleChars}
            onChange={(e) => {
              setTitle(e.target.value);
              setTitleTouched(true);
              setTitleError(null);
            }}
          />
        )}
      </Field>
      <fieldset className="m-0 grid gap-1.5 border-0 p-0" aria-labelledby={kindLabel}>
        <span id={kindLabel} className="text-ui font-medium">
          Kind <span className="font-normal text-text-muted">(optional)</span>
        </span>
        <div className="flex flex-wrap gap-2">
          {REFERENCE_KINDS.map((k) => (
            <Chip key={k} pressed={kind === k} onClick={() => setKind(kind === k ? null : k)}>
              {REFERENCE_KIND_LABEL[k]}
            </Chip>
          ))}
        </div>
      </fieldset>
      <Field label="Note (optional)" hint="What it is for, in your own words.">
        {(p) => (
          <TextArea
            {...p}
            value={note}
            maxLength={REFERENCE_LIMITS.noteChars}
            onChange={(e) => setNote(e.target.value)}
          />
        )}
      </Field>
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="text-ui font-medium">Where it belongs</span>
          <Button size="sm" onClick={choosePlaces}>
            <MapPin size={16} aria-hidden />
            {places.length ? "Change places" : "Choose places"}
          </Button>
        </div>
        {places.length === 0 ? (
          <p className="text-ui text-text-muted">
            Not tied to a lecture yet. Tie it to show it where you study.
          </p>
        ) : (
          <ul className="grid gap-1.5" aria-label="Places it belongs with">
            {places.map((p) => (
              <li
                key={p.nodeId}
                className="flex min-w-0 items-center gap-2 rounded-card border border-border bg-bg py-1 pl-3 pr-1"
              >
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-ui font-medium">{p.name}</span>
                  <span className="block truncate text-caption text-text-muted">{p.path}</span>
                </span>
                <IconButton
                  size="sm"
                  label={`Remove ${p.name}`}
                  onClick={() => setPlaces(places.filter((x) => x.nodeId !== p.nodeId))}
                >
                  <X size={16} />
                </IconButton>
              </li>
            ))}
          </ul>
        )}
      </div>
      <Switch label="Pin to the top" checked={favourite} onCheckedChange={setFavourite} />
      {formError ? (
        <p role="alert" className="text-ui text-danger">
          {formError}
        </p>
      ) : null}
      <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
        <Button onClick={onClose}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy}>
          {editing ? "Save changes" : "Save reference"}
        </Button>
      </div>
    </form>
  );
}
