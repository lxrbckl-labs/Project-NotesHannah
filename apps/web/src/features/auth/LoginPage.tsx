import { useQueryClient } from "@tanstack/react-query";
import { NotebookPen } from "lucide-react";
import { type FormEvent, useEffect, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router";
import { ThemeSwitch } from "../../app/ThemeSwitch";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { Field, TextInput } from "../../components/ui/field";
import { Notice } from "../../components/ui/notice";
import { api, isApiError } from "../../lib/api";
import { meKey, useMe } from "./useAuth";

const MOCK = import.meta.env.VITE_MOCK_API === "1";

function safeNext(value: string | null): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/library";
}

export function LoginPage() {
  const client = useQueryClient();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const me = useMe();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [waitUntil, setWaitUntil] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (waitUntil === null) return;
    const tick = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(tick);
  }, [waitUntil]);

  const remaining = waitUntil === null ? 0 : Math.max(0, Math.ceil((waitUntil - now) / 1000));
  const limited = waitUntil !== null && remaining > 0;

  if (me.isSuccess) return <Navigate to={safeNext(params.get("next"))} replace />;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (limited || busy) return;
    setBusy(true);
    setError(null);
    try {
      const user = await api.login({ username: username.trim().toLowerCase(), password });
      client.clear();
      client.setQueryData(meKey, user);
      navigate(safeNext(params.get("next")), { replace: true });
    } catch (caught) {
      setPassword("");
      if (isApiError(caught) && caught.code === "rate_limited") {
        const seconds = caught.retryAfter ?? 30;
        setNow(Date.now());
        setWaitUntil(Date.now() + seconds * 1000);
        setError("Too many attempts.");
      } else if (isApiError(caught) && caught.code === "unauthenticated") {
        setError("That username or password is not right. Check them and try again.");
      } else if (isApiError(caught) && caught.code === "invalid_input") {
        setError("Check the username: lowercase letters, digits, dot, dash or underscore.");
      } else {
        setError(isApiError(caught) ? caught.message : "Something went wrong. Try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dot-grid pt-safe pb-safe relative grid min-h-dvh place-items-center px-4 py-10">
      <div className="absolute right-4 top-4 pt-safe">
        <ThemeSwitch />
      </div>
      <main className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center text-center">
          <div className="mb-4 flex size-16 items-center justify-center rounded-panel bg-accent text-accent-contrast shadow-card">
            <NotebookPen size={30} aria-hidden />
          </div>
          <h1 className="font-display text-heading font-semibold">Welcome back</h1>
          <p className="mt-1.5 text-ui text-text-muted">Sign in to your study notes.</p>
        </div>

        <Card as="div" padding="lg" className="rounded-panel">
          <form onSubmit={submit} noValidate className="grid gap-4">
            {error ? (
              <Notice tone="danger">
                {error}
                {limited ? (
                  <span className="mt-0.5 block" aria-live="off">
                    Try again in {remaining} {remaining === 1 ? "second" : "seconds"}.
                  </span>
                ) : null}
              </Notice>
            ) : null}
            <Field label="Username">
              {(p) => (
                <TextInput
                  {...p}
                  name="username"
                  autoComplete="username"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              )}
            </Field>
            <Field label="Password">
              {(p) => (
                <TextInput
                  {...p}
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="primary"
              disabled={busy || limited || !username || !password}
              className="w-full"
            >
              {limited ? `Wait ${remaining}s` : busy ? "Signing in" : "Sign in"}
            </Button>
          </form>
        </Card>

        <p className="mt-5 text-center text-caption text-text-muted">
          Accounts are created for you. There is no sign-up.
        </p>
        {MOCK ? (
          <p className="mt-3 rounded-control bg-surface-muted px-3 py-2 text-center text-caption text-text-muted">
            Demo mode, no server. Sign in as <code>hannah</code> with <code>study-notes-2026</code>.
          </p>
        ) : null}
      </main>
    </div>
  );
}
