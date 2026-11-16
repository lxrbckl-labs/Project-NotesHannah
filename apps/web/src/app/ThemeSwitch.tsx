import { type ThemeChoice, useTheme } from "./theme";

const OPTIONS: { value: ThemeChoice; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
  { value: "system", label: "System" },
];

export function ThemeSwitch() {
  const [choice, setChoice] = useTheme();
  return (
    <fieldset className="inline-flex gap-1 rounded-2xl border border-border bg-surface-muted p-1">
      <legend className="sr-only">Theme</legend>
      {OPTIONS.map(({ value, label }) => (
        <button
          key={value}
          type="button"
          aria-pressed={choice === value}
          onClick={() => setChoice(value)}
          className="min-h-11 rounded-xl px-4 text-sm font-medium text-text-muted transition-colors hover:text-text aria-pressed:bg-accent aria-pressed:text-accent-contrast xl:min-h-8"
        >
          {label}
        </button>
      ))}
    </fieldset>
  );
}
