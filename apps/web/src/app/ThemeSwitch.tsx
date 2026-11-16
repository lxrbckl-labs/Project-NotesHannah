import { type ThemeChoice, useTheme } from "./theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  return (
    <fieldset className="flex gap-1 rounded-lg border border-border bg-surface-muted p-1">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => setChoice(value)}
          className="rounded-md px-3 py-1 text-sm text-text-muted aria-pressed:bg-accent aria-pressed:text-accent-contrast"
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
