import { Link } from "react-router";
import { Sheet } from "../../components/ui/sheet";
import { cn } from "../../lib/cn";
import { hotkeysIn } from "./guide";
import { useActiveHotkeys } from "./HotkeyProvider";
import { KBD_CLASS } from "./Kbd";
import { formatKeys, HOTKEY_GROUPS, type HotkeyDef, PLACE_LABEL } from "./registry";

/**
 * The "?" overlay: every hotkey in the registry, by group. Keys that work on the screen behind it are
 * drawn in full; the rest are quieter, with where they work. It lists only the registry, so it cannot
 * drift from what the keys do.
 */
export function ShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const active = useActiveHotkeys();
  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      title="Keyboard shortcuts"
      description="Single keys and pairs work when you are not typing. Keys in full work on this screen."
      placement="center"
      wide
      testId="shortcuts-dialog"
    >
      <div className="grid gap-x-8 gap-y-5 md:grid-cols-2">
        {HOTKEY_GROUPS.map((group) => {
          const list = hotkeysIn(group);
          if (list.length === 0) return null;
          return (
            <section key={group} aria-label={group} className="min-w-0">
              <h3 className="font-display text-body font-semibold text-accent">{group}</h3>
              <dl className="mt-1.5 grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 text-ui">
                {list.map((def) => (
                  <Row
                    key={def.id}
                    def={def}
                    here={def.selfHandled === true || active.has(def.id)}
                  />
                ))}
              </dl>
            </section>
          );
        })}
      </div>
      <p className="mt-6 text-label text-text-muted">
        The keys for writing (bold, headings, lists) are on the Keyboard button in a page’s toolbar.
        To hide the key badges beside buttons, go to{" "}
        <Link
          to="/settings#keyboard-shortcuts"
          onClick={() => onOpenChange(false)}
          className="text-accent underline-offset-2 hover:underline"
        >
          Settings, Keyboard shortcuts
        </Link>
        .
      </p>
    </Sheet>
  );
}

function Row({ def, here }: { def: HotkeyDef; here: boolean }) {
  return (
    <div
      data-hotkey-row={def.id}
      data-here={here || undefined}
      className="col-span-2 grid grid-cols-subgrid items-baseline border-t border-border py-1.5 first:border-t-0"
    >
      <dt className={cn("min-w-0", !here && "text-text-muted")}>
        {def.label}
        {here ? null : (
          <span className="block text-caption text-text-muted">{PLACE_LABEL[def.where]}</span>
        )}
      </dt>
      <dd className="flex flex-wrap justify-end gap-1">
        {def.display ? (
          <span className={KBD_CLASS}>{def.display}</span>
        ) : (
          def.keys.map((text) => (
            <kbd key={text} className={KBD_CLASS}>
              {formatKeys(text)}
            </kbd>
          ))
        )}
      </dd>
    </div>
  );
}
