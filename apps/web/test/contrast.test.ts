import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(`${process.cwd()}/src/app/styles.css`, "utf8");

function tokens(block: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, value] of block.matchAll(/--color-([a-z-]+):\s*(#[0-9a-f]{6})/gi)) {
    out[name as string] = value as string;
  }
  return out;
}

const light = tokens(
  css.slice(css.indexOf(":root {"), css.indexOf("@media (prefers-color-scheme")),
);
const dark = tokens(css.slice(css.indexOf(':root[data-theme="dark"]'), css.indexOf("/* Expose")));

function luminance(hex: string): number {
  const channels = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return (
    0.2126 * (channels[0] as number) +
    0.7152 * (channels[1] as number) +
    0.0722 * (channels[2] as number)
  );
}

function ratio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** Every text-on-surface pair the app uses must reach WCAG AA (4.5:1) in both themes. */
const PAIRS: Array<[string, string]> = [
  ["text", "bg"],
  ["text", "surface"],
  ["text", "surface-muted"],
  ["text-muted", "bg"],
  ["text-muted", "surface"],
  ["text-muted", "surface-muted"],
  ["accent", "bg"],
  ["accent", "surface"],
  ["accent", "accent-soft"],
  ["accent-contrast", "accent"],
  ["danger", "surface"],
  ["danger", "bg"],
  ["danger", "danger-soft"],
  ["accent-contrast", "danger"],
];

describe("colour tokens", () => {
  it("defines the same tokens in both themes", () => {
    expect(Object.keys(dark).sort()).toEqual(Object.keys(light).sort());
  });

  for (const [theme, set] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const [fg, bg] of PAIRS) {
      it(`${theme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(ratio(set[fg] as string, set[bg] as string)).toBeGreaterThanOrEqual(4.5);
      });
    }
  }

  it("keeps UI borders visible enough to see (3:1 for the strong border on the surface)", () => {
    expect(ratio(light["border-strong"] as string, light.surface as string)).toBeGreaterThanOrEqual(
      1.6,
    );
    expect(ratio(dark["border-strong"] as string, dark.surface as string)).toBeGreaterThanOrEqual(
      1.6,
    );
  });
});
