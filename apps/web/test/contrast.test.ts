import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { HUES } from "../src/lib/hues";

const css = readFileSync(`${process.cwd()}/src/app/styles.css`, "utf8");

/** The body of the first rule whose selector line is exactly `selector`, braces balanced. */
function block(selector: string, from = 0): string {
  const start = css.indexOf(`${selector} {`, from);
  if (start < 0) throw new Error(`No block for ${selector}`);
  let depth = 0;
  for (let i = css.indexOf("{", start); i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(css.indexOf("{", start) + 1, i);
  }
  throw new Error(`Unclosed block for ${selector}`);
}

/** Every custom property in a block, comments removed. */
function declarations(body: string): Record<string, string> {
  const out: Record<string, string> = {};
  const clean = body.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const [, name, value] of clean.matchAll(/--([a-z0-9-]+):\s*([^;]+);/gi)) {
    out[name as string] = (value as string).trim();
  }
  return out;
}

const lightBase = declarations(block(":root"));
const darkMedia = declarations(block(':root:not([data-theme="light"])'));
const darkAttr = declarations(block(':root[data-theme="dark"]'));
// The second plain :root block: semantic colours and scales that point at the palette.
const shared = declarations(block(":root", css.indexOf(':root[data-theme="dark"]') + 1));

const light = { ...lightBase, ...shared };
const dark = { ...lightBase, ...shared, ...darkAttr };

/** Follow var(--x) references until a hex colour. */
function resolve(set: Record<string, string>, name: string, seen: string[] = []): string {
  const value = set[name];
  if (value === undefined) throw new Error(`--${name} is not defined`);
  const ref = value.match(/^var\(--([a-z0-9-]+)\)$/i);
  if (ref) {
    if (seen.includes(name)) throw new Error(`--${name} refers to itself`);
    return resolve(set, ref[1] as string, [...seen, name]);
  }
  if (!/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`--${name} is not a hex colour: ${value}`);
  return value;
}

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

const SHADES = ["solid", "soft", "text", "border", "mark"] as const;
const BACKGROUNDS = ["color-bg", "color-surface", "color-surface-muted"] as const;

/** Every text-on-background pair the app uses must reach WCAG AA (4.5:1) in both themes. */
const PAIRS: Array<[string, string]> = [
  ["color-text", "color-bg"],
  ["color-text", "color-surface"],
  ["color-text", "color-surface-muted"],
  ["color-text-muted", "color-bg"],
  ["color-text-muted", "color-surface"],
  ["color-text-muted", "color-surface-muted"],
  ["color-accent", "color-bg"],
  ["color-accent", "color-surface"],
  ["color-accent", "color-accent-soft"],
  ["color-accent-contrast", "color-accent"],
  // Tooltips: the page colour on the text colour.
  ["color-bg", "color-text"],
];

// Semantic colours: on their soft background and on every base background.
for (const role of ["danger", "success", "warning", "info"]) {
  PAIRS.push([`color-${role}`, `color-${role}-soft`]);
  // A filled button in this colour carries the accent-contrast text, like danger.
  PAIRS.push(["color-accent-contrast", `color-${role}`]);
  for (const bg of BACKGROUNDS) PAIRS.push([`color-${role}`, bg]);
}

// Every hue: its text on its soft background and on every base background; body text and
// muted text on its soft and mark shades (tinted cards, highlights).
for (const hue of HUES) {
  PAIRS.push([`hue-${hue}-text`, `hue-${hue}-soft`]);
  for (const bg of BACKGROUNDS) PAIRS.push([`hue-${hue}-text`, bg]);
  PAIRS.push(["color-text", `hue-${hue}-soft`]);
  PAIRS.push(["color-text-muted", `hue-${hue}-soft`]);
  PAIRS.push(["color-text", `hue-${hue}-mark`]);
}

describe("colour tokens", () => {
  it("keeps the two dark blocks identical", () => {
    expect(darkAttr).toEqual(darkMedia);
  });

  it("overrides in dark only tokens that light defines", () => {
    for (const name of Object.keys(darkAttr)) expect(lightBase).toHaveProperty(name);
  });

  it("defines every colour in both themes", () => {
    const colours = (set: Record<string, string>) =>
      Object.keys(set).filter((n) => n.startsWith("color-") || n.startsWith("hue-"));
    expect(colours(darkAttr).sort()).toEqual(colours(lightBase).sort());
  });

  it("gives every hue all five shades", () => {
    for (const hue of HUES) {
      for (const shade of SHADES) {
        expect(lightBase, `light ${hue}-${shade}`).toHaveProperty(`hue-${hue}-${shade}`);
        expect(darkAttr, `dark ${hue}-${shade}`).toHaveProperty(`hue-${hue}-${shade}`);
      }
    }
  });

  it("maps every hue to a data-hue rule and a Tailwind colour", () => {
    for (const hue of HUES) {
      expect(css).toContain(`[data-hue="${hue}"] {`);
      for (const shade of SHADES) {
        expect(css).toContain(`--color-hue-${hue}-${shade}: var(--hue-${hue}-${shade});`);
      }
    }
  });

  for (const [theme, set] of [
    ["light", light],
    ["dark", dark],
  ] as const) {
    for (const [fg, bg] of PAIRS) {
      it(`${theme}: ${fg} on ${bg} is at least 4.5:1`, () => {
        expect(ratio(resolve(set, fg), resolve(set, bg))).toBeGreaterThanOrEqual(4.5);
      });
    }

    it(`${theme}: every solid shade stands out from the surface (3:1, for dots and lines)`, () => {
      for (const hue of HUES) {
        expect(
          ratio(resolve(set, `hue-${hue}-solid`), resolve(set, "color-surface")),
          hue,
        ).toBeGreaterThanOrEqual(3);
      }
    });
  }

  it("keeps UI borders visible enough to see (1.6:1 for the strong border on the surface)", () => {
    for (const set of [light, dark]) {
      expect(
        ratio(resolve(set, "color-border-strong"), resolve(set, "color-surface")),
      ).toBeGreaterThanOrEqual(1.6);
    }
  });
});
