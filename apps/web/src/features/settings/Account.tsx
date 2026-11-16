import { ChangePasswordInput } from "@notes/schema";
import { type FormEvent, useState } from "react";
import { Button } from "../../components/ui/button";
import { ConfirmDialog } from "../../components/ui/dialog";
import { Field, TextInput } from "../../components/ui/field";
import { Notice } from "../../components/ui/notice";
import { api, describeError } from "../../lib/api";
import { useSignOut } from "../auth/useAuth";

export function ChangePassword() {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setDone(false);
    setError(null);
    if (next !== again) {
      setError("The two new passwords are different.");
      return;
    }
    const parsed = ChangePasswordInput.safeParse({ currentPassword: current, newPassword: next });
    if (!parsed.success) {
      setError("The new password needs at least 10 characters.");
      return;
    }
    setBusy(true);
    try {
      await api.changePassword(parsed.data);
      setCurrent("");
      setNext("");
      setAgain("");
      setDone(true);
    } catch (caught) {
      const { message, hint } = describeError(caught);
      setError(hint ? `${message} ${hint}` : message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid max-w-md gap-4" noValidate>
      {error ? <Notice tone="danger">{error}</Notice> : null}
      {done ? (
        <div role="status">
          <Notice tone="success">Password changed. Your other devices were signed out.</Notice>
        </div>
      ) : null}
      <Field label="Current password">
        {(p) => (
          <TextInput
            {...p}
            type="password"
            autoComplete="current-password"
            value={current}
            onChange={(e) => setCurrent(e.target.value)}
          />
        )}
      </Field>
      <Field label="New password" hint="At least 10 characters.">
        {(p) => (
          <TextInput
            {...p}
            type="password"
            autoComplete="new-password"
            value={next}
            onChange={(e) => setNext(e.target.value)}
          />
        )}
      </Field>
      <Field label="New password again">
        {(p) => (
          <TextInput
            {...p}
            type="password"
            autoComplete="new-password"
            value={again}
            onChange={(e) => setAgain(e.target.value)}
          />
        )}
      </Field>
      <div>
        <Button type="submit" variant="primary" disabled={busy || !current || !next || !again}>
          Change password
        </Button>
      </div>
    </form>
  );
}

export function SignOutControls() {
  const signOut = useSignOut();
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => void signOut(false)}>Sign out</Button>
      <Button variant="ghostDanger" onClick={() => setConfirming(true)}>
        Sign out everywhere
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Sign out everywhere?"
        description="This ends every session on every device, including this one. You will need to sign in again."
        confirmLabel="Sign out everywhere"
        danger
        onConfirm={() => {
          setConfirming(false);
          void signOut(true);
        }}
      />
    </div>
  );
}
