import { SegmentedControl } from "../components/ui/segmented";
import { type ThemeChoice, useTheme } from "./theme";

const ITEMS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  return (
    <SegmentedControl
      label="Theme"
      look="pill"
      value={choice}
      onValueChange={setChoice}
      items={ITEMS}
      className="w-fit rounded-pill border border-border bg-surface-muted p-1"
    />
  );
}
