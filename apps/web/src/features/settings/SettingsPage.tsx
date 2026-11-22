import {
  BookMarked,
  Bot,
  ChevronRight,
  LifeBuoy,
  Lightbulb,
  MessageCirclePlus,
  Palette,
  Settings,
  Trash2,
} from "lucide-react";
import { type ReactNode, useEffect } from "react";
import { Link, useLocation } from "react-router";
import { ThemeSwitch } from "../../app/ThemeSwitch";
import { Page } from "../../components/Page";
import { Card, CardTitle } from "../../components/ui/card";
import { PageHeader } from "../../components/ui/page-header";
import { useMe } from "../auth/useAuth";
import { LoveLetter } from "../letter/LoveLetter";
import { ChangePassword, SignOutControls } from "./Account";
import { ApiKeys } from "./ApiKeys";
import { BackgroundCard } from "./BackgroundCard";
import { InstructionsCard } from "./InstructionsCard";
import { KeyboardCard } from "./KeyboardCard";
import { TabBarCard } from "./TabBarCard";

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
  // A link to one card (the request dialog's "Manage" goes to #instructions) brings that card into view.
  const { hash } = useLocation();
  useEffect(() => {
    if (!hash) return;
    document.getElementById(hash.slice(1))?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [hash]);
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

        <InstructionsCard />

        <BackgroundCard />

        <TabBarCard />

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
            <LinkRow to="/concepts" icon={<Lightbulb size={18} />}>
              Concepts
            </LinkRow>
            <LinkRow to="/references" icon={<BookMarked size={18} />}>
              References
            </LinkRow>
            <LinkRow to="/requests" icon={<MessageCirclePlus size={18} />}>
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

        {/* Keys need a keyboard: shown from the tablet layout up, where the shortcuts work. */}
        <div className="hidden md:block">
          <KeyboardCard />
        </div>
      </div>
      {/* On a phone there is no sidebar, so the note for Hannah sits here, at the bottom right. */}
      <div className="mt-6 flex justify-end md:hidden">
        <LoveLetter />
      </div>
    </Page>
  );
}
