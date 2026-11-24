import { HOME_PAGES } from "@notes/schema";
import { HOME_DEFS } from "../../app/home";
import { Card, CardTitle } from "../../components/ui/card";
import { cn } from "../../lib/cn";
import { useHomePage, useSaveHomePage } from "../preferences/usePreferences";

/**
 * Settings, "Home page": where the app's mark at the top left leads, picked from the sidebar's main
 * places. Saved on her account, so it follows her to every device. The header (and so the mark) is on a
 * tablet and a computer; a phone has its tab bar instead.
 */
export function HomeCard() {
  const current = useHomePage();
  const save = useSaveHomePage();
  return (
    <Card as="section" id="home-page" aria-labelledby="card-home-page" padding="lg">
      <CardTitle
        id="card-home-page"
        title="Home page"
        description="Where the pill button at the top left takes you, on a tablet or a computer."
      />
      <div
        role="radiogroup"
        aria-labelledby="card-home-page"
        className="grid grid-cols-2 gap-2 sm:grid-cols-4"
      >
        {HOME_PAGES.map((id) => {
          const { label, icon: Icon } = HOME_DEFS[id];
          const checked = id === current;
          return (
            // biome-ignore lint/a11y/useSemanticElements: a picture-and-name choice, drawn as a button
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={checked}
              onClick={() => !checked && save.mutate(id)}
              className={cn(
                "flex min-h-11 items-center gap-2.5 rounded-control border px-3 text-ui font-medium transition-colors duration-(--duration-instant)",
                checked
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border-strong bg-surface text-text hover:bg-surface-muted",
              )}
            >
              <Icon size={18} aria-hidden />
              {label}
            </button>
          );
        })}
      </div>
    </Card>
  );
}
