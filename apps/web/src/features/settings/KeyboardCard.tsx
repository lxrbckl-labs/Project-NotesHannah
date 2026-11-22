import { Keyboard } from "lucide-react";
import { useState } from "react";
import { Button } from "../../components/ui/button";
import { Card, CardTitle } from "../../components/ui/card";
import { Switch } from "../../components/ui/switch";
import { ShortcutsDialog } from "../hotkeys";
import { useSaveShortcutBadges, useShortcutBadges } from "../preferences/usePreferences";

/**
 * Settings, "Keyboard shortcuts": the switch for the small key badges beside buttons (and the keys in
 * hints and menus), and the full list. Turning the badges off leaves every key working. Saved on her
 * account, so it follows her to every computer.
 */
export function KeyboardCard() {
  const on = useShortcutBadges();
  const save = useSaveShortcutBadges();
  const [listOpen, setListOpen] = useState(false);
  return (
    <Card
      as="section"
      id="keyboard-shortcuts"
      aria-labelledby="card-keyboard-shortcuts"
      padding="lg"
    >
      <CardTitle
        id="card-keyboard-shortcuts"
        title="Keyboard shortcuts"
        description="With a keyboard, most buttons have a key. Press ? on any screen to see them all."
      />
      <Switch
        label="Show keyboard shortcut badges"
        description="Small keys beside buttons, in hints and in menus, on a computer. The shortcuts work either way."
        checked={on}
        onCheckedChange={(next) => save.mutate(next)}
      />
      <div className="mt-4">
        <Button hotkey="app.shortcuts" onClick={() => setListOpen(true)}>
          <Keyboard size={16} aria-hidden /> Show all shortcuts
        </Button>
      </div>
      <ShortcutsDialog open={listOpen} onOpenChange={setListOpen} />
    </Card>
  );
}
