import type { ApiKey, CreatedApiKey } from "@notes/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Copy, KeyRound, Plus } from "lucide-react";
import { type FormEvent, useState } from "react";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { ConfirmDialog, Modal } from "../../components/ui/dialog";
import { Field, TextInput } from "../../components/ui/field";
import { Notice } from "../../components/ui/notice";
import { EmptyState, ErrorState, LoadingList } from "../../components/ui/states";
import { useToast } from "../../components/ui/toast";
import { api, describeError } from "../../lib/api";
import { cn } from "../../lib/cn";
import { formatDate, formatDateTime } from "../../lib/format";

const KEYS = ["keys"] as const;

export function ApiKeys() {
  const client = useQueryClient();
  const toast = useToast();
  const query = useQuery({ queryKey: KEYS, queryFn: api.listKeys });
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<ApiKey | null>(null);

  const revoke = useMutation({
    mutationFn: (key: ApiKey) => api.revokeKey(key.id),
    onSuccess: (_data, key) => toast.show(`Revoked "${key.name}". It no longer works.`),
    onError: (error) => toast.error(error),
    onSettled: () => client.invalidateQueries({ queryKey: KEYS }),
  });

  return (
    <Card as="section" aria-labelledby="keys-title" padding="lg">
      <CardTitle
        id="keys-title"
        title="API keys"
        description="Keys let an agent such as Claude Code or Codex work in your library. Give each its own key so you can revoke one without touching the rest."
        action={
          <Button variant="primary" onClick={() => setCreating(true)}>
            <Plus size={16} aria-hidden />
            New key
          </Button>
        }
      />

      <div>
        {query.isPending ? (
          <LoadingList rows={2} label="Loading keys" />
        ) : query.isError ? (
          <ErrorState error={query.error} onRetry={() => query.refetch()} />
        ) : query.data.length === 0 ? (
          <EmptyState icon={<KeyRound size={26} />} title="No keys yet">
            Create a key when you want an agent to read or edit your library.
          </EmptyState>
        ) : (
          <ul className="grid gap-2.5" aria-label="API keys">
            {query.data.map((key) => (
              <KeyRow key={key.id} apiKey={key} onRevoke={() => setRevoking(key)} />
            ))}
          </ul>
        )}
      </div>

      <CreateKeyDialog open={creating} onClose={() => setCreating(false)} />
      <ConfirmDialog
        open={!!revoking}
        onOpenChange={(open) => !open && setRevoking(null)}
        title={revoking ? `Revoke "${revoking.name}"?` : ""}
        description="Anything using this key stops working at once. You cannot turn it back on, but you can create a new key."
        confirmLabel="Revoke key"
        danger
        onConfirm={() => {
          const key = revoking;
          setRevoking(null);
          if (key) revoke.mutate(key);
        }}
      />
    </Card>
  );
}

function KeyRow({ apiKey, onRevoke }: { apiKey: ApiKey; onRevoke: () => void }) {
  const revoked = !!apiKey.revokedAt;
  return (
    <Card
      as="li"
      flat
      data-testid="key-row"
      data-revoked={revoked}
      className={cn("flex flex-wrap items-center gap-x-4 gap-y-3", revoked && "opacity-75")}
    >
      <div className="min-w-0 flex-1 basis-56">
        <div className="flex flex-wrap items-center gap-2">
          <p className={cn("font-medium", revoked && "line-through")}>{apiKey.name}</p>
          <Badge tone={apiKey.scope === "write" ? "accent" : "neutral"}>
            {apiKey.scope === "write" ? "Read and write" : "Read only"}
          </Badge>
          {revoked ? <Badge tone="danger">Revoked</Badge> : null}
        </div>
        <p className="mt-1 font-mono text-ui text-text-muted">{apiKey.preview}…</p>
        <p className="mt-1 text-sm text-text-muted">
          Created {formatDate(apiKey.createdAt)} ·{" "}
          {apiKey.lastUsedAt ? `Last used ${formatDateTime(apiKey.lastUsedAt)}` : "Never used"}
          {revoked && apiKey.revokedAt ? ` · Revoked ${formatDate(apiKey.revokedAt)}` : ""}
        </p>
      </div>
      {!revoked ? (
        <Button variant="ghostDanger" onClick={onRevoke} aria-label={`Revoke ${apiKey.name}`}>
          Revoke
        </Button>
      ) : null}
    </Card>
  );
}

export function CreateKeyDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const [created, setCreated] = useState<CreatedApiKey | null>(null);

  function close() {
    setCreated(null);
    onClose();
    void client.invalidateQueries({ queryKey: KEYS });
  }

  return (
    <Modal
      open={open}
      onOpenChange={(next) => !next && close()}
      title={created ? "Your new key" : "New API key"}
      description={
        created
          ? "Copy it now and keep it somewhere safe."
          : "Choose a name you will recognise and what the key may do."
      }
    >
      {created ? (
        <SecretView created={created} onDone={close} />
      ) : (
        <CreateKeyForm onCreated={setCreated} onCancel={close} />
      )}
    </Modal>
  );
}

function CreateKeyForm({
  onCreated,
  onCancel,
}: {
  onCreated: (created: CreatedApiKey) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState("");
  const [scope, setScope] = useState<"read" | "write">("read");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onCreated(await api.createKey({ name: name.trim(), scope }));
    } catch (caught) {
      const { message, hint } = describeError(caught);
      setError(hint ? `${message} ${hint}` : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      {error ? <Notice tone="danger">{error}</Notice> : null}
      <Field label="Name" hint="For example, Claude Code on the MacBook.">
        {(p) => (
          <TextInput
            {...p}
            autoFocus
            value={name}
            maxLength={80}
            onChange={(e) => setName(e.target.value)}
          />
        )}
      </Field>
      <fieldset className="grid gap-2">
        <legend className="mb-1 text-sm font-medium">Access</legend>
        {(
          [
            ["read", "Read only", "Can browse and search. Cannot change anything."],
            ["write", "Read and write", "Can also create, rename, move and trash."],
          ] as const
        ).map(([value, label, hint]) => (
          <label
            key={value}
            className={cn(
              "flex min-h-14 cursor-pointer items-start gap-3 rounded-card border p-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent",
              scope === value
                ? "border-accent bg-accent-soft"
                : "border-border hover:bg-surface-muted",
            )}
          >
            <input
              type="radio"
              name="scope"
              value={value}
              checked={scope === value}
              onChange={() => setScope(value)}
              className="mt-1 size-4 accent-(--color-accent)"
            />
            <span>
              <span className="block text-sm font-medium">{label}</span>
              <span className="block text-sm text-text-muted">{hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>
          Create key
        </Button>
      </div>
    </form>
  );
}

function SecretView({ created, onDone }: { created: CreatedApiKey; onDone: () => void }) {
  const [copied, setCopied] = useState<"yes" | "failed" | null>(null);

  async function copy() {
    try {
      await navigator.clipboard.writeText(created.secret);
      setCopied("yes");
    } catch {
      setCopied("failed");
    }
  }

  return (
    <div className="grid gap-4">
      <div role="alert">
        <Notice tone="warning">
          You will not see this again. Copy it now: once you close this, the key cannot be shown.
        </Notice>
      </div>
      <div>
        <p className="mb-1.5 text-sm font-medium">{created.key.name}</p>
        <code
          data-testid="api-secret"
          className="block break-all rounded-control border border-border-strong bg-bg p-3.5 font-mono text-ui"
        >
          {created.secret}
        </code>
        {copied === "failed" ? (
          <p className="mt-2 text-ui text-danger">
            Copying was blocked. Select the key above and copy it by hand.
          </p>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <Button onClick={copy}>
          {copied === "yes" ? <Check size={16} aria-hidden /> : <Copy size={16} aria-hidden />}
          {copied === "yes" ? "Copied" : "Copy key"}
        </Button>
        <Button variant="primary" onClick={onDone}>
          I have saved it
        </Button>
      </div>
    </div>
  );
}
