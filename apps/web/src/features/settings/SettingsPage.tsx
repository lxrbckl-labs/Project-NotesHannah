import {
  BookMarked,
  Bot,
  ChevronRight,
  LifeBuoy,
  MessageSquarePlus,
  Palette,
  Settings,
  Trash2,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router";
import { MOD_KEY } from "../../app/AppShell";
import { ThemeSwitch } from "../../app/ThemeSwitch";
import { Page } from "../../components/Page";
import { Card, CardTitle } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { useMe } from "../auth/useAuth";
import { ChangePassword, SignOutControls } from "./Account";
import { ApiKeys } from "./ApiKeys";

function SettingsCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string | undefined;
  children: ReactNode;
}) {
  const id = `card-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <Card as="section" aria-labelledby={id} padding="lg">
      <CardTitle id={id} title={title} description={description} />
      {children}
    </Card>
  );
}

/** A row that opens another screen: icon, name, chevron. */
function LinkRow({ to, icon, children }: { to: string; icon: ReactNode; children: string }) {
  return (
    <Link
      to={to}
      className="flex min-h-12 items-center gap-3 rounded-card border border-border bg-bg px-4 transition-colors duration-(--duration-instant) hover:border-border-strong hover:bg-surface-muted"
    >
      <span aria-hidden className="text-text-muted">
        {icon}
      </span>
      <span className="flex-1 text-ui font-medium">{children}</span>
      <ChevronRight size={16} aria-hidden className="text-text-muted" />
    </Link>
  );
}

export function SettingsPage() {
  const me = useMe();
  return (
    <Page>
      <PageHeader title="Settings" icon={<Settings />} />
      <div className="grid gap-5">
        <SettingsCard title="Appearance" description="Follow your device, or pick light or dark.">
          <ThemeSwitch />
          <div className="mt-4">
            <LinkRow to="/design" icon={<Palette size={18} />}>
              Design reference
            </LinkRow>
          </div>
        </SettingsCard>

        <SettingsCard
          title="Account"
          description={
            me.data ? `Signed in as ${me.data.displayName} (${me.data.username}).` : undefined
          }
        >
          <SignOutControls />
        </SettingsCard>

        <SettingsCard title="Password" description="Changing it signs your other devices out.">
          <ChangePassword />
        </SettingsCard>

        <ApiKeys />

        <SettingsCard title="Library">
          <div className="grid gap-2">
            <LinkRow to="/help" icon={<LifeBuoy size={18} />}>
              Guide
            </LinkRow>
            <LinkRow to="/references" icon={<BookMarked size={18} />}>
              References
            </LinkRow>
            <LinkRow to="/requests" icon={<MessageSquarePlus size={18} />}>
              Requests
            </LinkRow>
            <LinkRow to="/activity" icon={<Bot size={18} />}>
              Activity
            </LinkRow>
            <LinkRow to="/trash" icon={<Trash2 size={18} />}>
              Trash
            </LinkRow>
          </div>
        </SettingsCard>

        <div className="hidden xl:block">
          <SettingsCard title="Keyboard shortcuts">
            <dl className="grid max-w-md grid-cols-[1fr_auto] gap-x-6 gap-y-2 text-ui">
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
                    <kbd className="rounded-inline border border-border bg-bg px-1.5 py-0.5 text-caption">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </SettingsCard>
        </div>
      </div>
    </Page>
  );
}
