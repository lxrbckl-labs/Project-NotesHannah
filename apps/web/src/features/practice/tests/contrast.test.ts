import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "vitest";

/** WCAG contrast of the colour pairs this feature relies on, in both themes. */
const read = (p: string) => readFileSync(resolve(process.cwd(), p), "utf8");
const app = read("src/app/styles.css");
const mine = read("src/features/practice/practice.css");

function block(css: string, selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector}`);
  const end = css.indexOf("}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

const light = { ...block(app, ":root"), ...block(mine, ":root") };
const dark = {
  ...block(app, ':root[data-theme="dark"]'),
  ...block(mine, ':root[data-theme="dark"]'),
};

function lum(hex: string): number {
  const c = [1, 3, 5].map((i) => {
    const v = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (c[0] as number) + 0.7152 * (c[1] as number) + 0.0722 * (c[2] as number);
}
function ratio(a: string, b: string): number {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

const PAIRS: [string, string][] = [
  ["--color-text", "--color-bg"],
  ["--color-text", "--color-surface"],
  ["--color-text-muted", "--color-bg"],
  ["--color-text-muted", "--color-surface"],
  ["--color-text-muted", "--color-surface-muted"],
  ["--color-accent", "--color-bg"],
  ["--color-accent", "--color-surface"],
  ["--color-accent", "--pr-accent-soft"],
  ["--color-accent-contrast", "--color-accent"],
  ["--color-text", "--pr-accent-soft"],
  ["--pr-correct", "--pr-correct-bg"],
  ["--pr-wrong", "--pr-wrong-bg"],
  ["--pr-partial", "--pr-partial-bg"],
  ["--pr-correct", "--color-surface"],
  ["--pr-partial", "--color-surface"],
];

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`AA contrast (4.5:1) for text pairs in the ${name} theme`, () => {
    for (const [fg, bg] of PAIRS) {
      const a = theme[fg];
      const b = theme[bg];
      expect(a, `${fg} defined`).toBeDefined();
      expect(b, `${bg} defined`).toBeDefined();
      expect(
        ratio(a as string, b as string),
        `${fg} on ${bg} (${a} / ${b})`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });
}

test("the six numbered-link badge colours carry their number legibly in both themes", () => {
  for (const theme of [light, dark]) {
    for (let i = 1; i <= 6; i++) {
      expect(
        ratio(theme["--pr-link-ink"] as string, theme[`--pr-link-${i}`] as string),
      ).toBeGreaterThanOrEqual(4.5);
    }
  }
});
