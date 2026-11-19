import { readFileSync } from "node:fs";
import { expect, test } from "vitest";
import { seriesHue } from "../../../lib/hues";
import { FEEDBACK_HUE, RATING_HUE } from "../../../lib/roles";

/**
 * The colours here all come from the shared palette; test/contrast.test.ts checks every hue.
 * This test checks the pairs the practice screens build from them, in both themes: the matching
 * badges (the text shade as the fill, the soft shade as the text) and the feedback roles.
 */
const css = readFileSync(`${process.cwd()}/src/app/styles.css`, "utf8");
const mine = readFileSync(`${process.cwd()}/src/features/practice/practice.css`, "utf8");

function block(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector}`);
  const end = css.indexOf("}", start);
  const out: Record<string, string> = {};
  for (const m of css.slice(start, end).matchAll(/(--[\w-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[m[1] as string] = m[2] as string;
  }
  return out;
}

const light = block(":root");
const dark = { ...light, ...block(':root[data-theme="dark"]') };

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

const hues = [
  ...Array.from({ length: 6 }, (_, i) => seriesHue(i)),
  ...Object.values(FEEDBACK_HUE),
  ...Object.values(RATING_HUE),
];

for (const [name, theme] of [
  ["light", light],
  ["dark", dark],
] as const) {
  test(`pair badges and feedback roles reach AA in the ${name} theme`, () => {
    for (const hue of new Set(hues)) {
      const text = theme[`--hue-${hue}-text`];
      const soft = theme[`--hue-${hue}-soft`];
      expect(text, `${hue} text`).toBeDefined();
      expect(soft, `${hue} soft`).toBeDefined();
      expect(ratio(text as string, soft as string), `${hue}`).toBeGreaterThanOrEqual(4.5);
    }
    // Body text on the accent tint of a selected option.
    expect(
      ratio(theme["--color-text"] as string, theme["--color-accent-soft"] as string),
    ).toBeGreaterThanOrEqual(4.5);
  });
}

test("the practice stylesheet holds no colors of its own", () => {
  expect(mine).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgb\(|hsl\(|--pr-(?!top|bottom|vh|vt|ruler)/);
});
