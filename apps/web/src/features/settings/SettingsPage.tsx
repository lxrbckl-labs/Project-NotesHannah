import { Bot, ChevronRight, Trash2 } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { MOD_KEY } from "../../app/AppShell";
import { ThemeSwitch } from "../../app/ThemeSwitch";
import { Page } from "../../components/Page";
import { useMe } from "../auth/useAuth";
import { ChangePassword, SignOutControls } from "./Account";
import { ApiKeys } from "./ApiKeys";

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  const id = `card-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <section
      aria-labelledby={id}
      className="rounded-3xl border border-border bg-surface p-5 shadow-card md:p-6"
    >
      <h2 id={id} className="text-lg font-semibold">
        {title}
      </h2>
      {description ? <p className="mt-1 text-sm text-text-muted">{description}</p> : null}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export function SettingsPage() {
  const me = useMe();
  return (
    <Page>
      <h1 className="mb-6 text-3xl font-semibold">Settings</h1>
      <div className="grid gap-5">
        <Card title="Appearance" description="Follow your device, or pick light or dark.">
          <ThemeSwitch />
        </Card>

        <Card
          title="Account"
          description={
            me.data ? `Signed in as ${me.data.displayName} (${me.data.username}).` : undefined
          }
        >
          <SignOutControls />
        </Card>

        <Card title="Password" description="Changing it signs your other devices out.">
          <ChangePassword />
        </Card>

        <ApiKeys />

        <Card title="Library">
          <Link
            to="/activity"
            className="mb-2 flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-bg px-4 hover:border-border-strong"
          >
            <Bot size={18} aria-hidden className="text-text-muted" />
            <span className="flex-1 text-sm font-medium">Activity</span>
            <ChevronRight size={16} aria-hidden className="text-text-muted" />
          </Link>
          <Link
            to="/trash"
            className="flex min-h-12 items-center gap-3 rounded-2xl border border-border bg-bg px-4 hover:border-border-strong"
          >
            <Trash2 size={18} aria-hidden className="text-text-muted" />
            <span className="flex-1 text-sm font-medium">Trash</span>
            <ChevronRight size={16} aria-hidden className="text-text-muted" />
          </Link>
        </Card>

        <div className="hidden xl:block">
          <Card title="Keyboard shortcuts">
            <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-sm">
              {[
                [`${MOD_KEY}K`, "Quick find"],
                ["/", "Quick find"],
                [`${MOD_KEY}\\`, "Show or hide the sidebar"],
                ["F2", "Rename the focused item"],
                ["Delete", "Move the focused item to the trash"],
                ["Arrow keys", "Move through the sidebar tree"],
              ].map(([keys, what]) => (
                <div key={`${keys}-${what}`} className="contents">
                  <dt>{what}</dt>
                  <dd>
                    <kbd className="rounded-md border border-border bg-bg px-1.5 py-0.5 text-xs">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </Page>
  );
}
