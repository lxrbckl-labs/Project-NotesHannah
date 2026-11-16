import {
  CALLOUT_KINDS,
  COLOR_TOKENS,
  CONCEPT_TYPES,
  CONNECTOR_KINDS,
  FileStatus,
  RequestStatus,
} from "@notes/schema";
import { describe, expect, it } from "vitest";
import {
  CATEGORICAL_HUES,
  HUE_LABEL,
  HUES,
  hueForId,
  hueOf,
  hueVar,
  isHue,
  seriesHue,
} from "./hues";
import {
  CALLOUT_HUE,
  CONCEPT_TYPE_HUE,
  CONNECTOR_HUE,
  DOCUMENT_HUE,
  FEEDBACK_HUE,
  FILE_STATUS_HUE,
  RATING_HUE,
  REQUEST_STATUS_HUE,
  SEVERITY_HUE,
  STATUS_TONE,
} from "./roles";

describe("hues", () => {
  it("are the schema's colour tokens, so stored colours need no mapping", () => {
    expect(HUES).toEqual(COLOR_TOKENS);
    for (const hue of HUES) expect(HUE_LABEL[hue]).toBeTruthy();
  });

  it("offers eight lively hues for things with no colour of their own", () => {
    expect(CATEGORICAL_HUES).toHaveLength(8);
    expect(CATEGORICAL_HUES).not.toContain("gray");
    for (const hue of CATEGORICAL_HUES) expect(isHue(hue)).toBe(true);
  });

  it("gives the same id the same hue every time", () => {
    const id = "nod_01HZX8Y4Q2K3M5N6P7R8S9T0V1";
    expect(hueForId(id)).toBe(hueForId(id));
    expect(hueForId(id)).toBe(hueForId(`${id}`));
  });

  it("spreads ids across the lively hues", () => {
    const seen = new Set(Array.from({ length: 200 }, (_, i) => hueForId(`course-${i}`)));
    expect(seen.size).toBe(CATEGORICAL_HUES.length);
  });

  it("prefers a chosen colour over the hashed one", () => {
    expect(hueOf("anything", "brown")).toBe("brown");
    expect(hueOf("anything", null)).toBe(hueForId("anything"));
  });

  it("cycles a series, including negative and fractional indexes", () => {
    expect(seriesHue(0)).toBe(CATEGORICAL_HUES[0]);
    expect(seriesHue(8)).toBe(CATEGORICAL_HUES[0]);
    expect(seriesHue(-1)).toBe(CATEGORICAL_HUES[7]);
    expect(seriesHue(2.7)).toBe(CATEGORICAL_HUES[2]);
  });

  it("names the CSS variable for a shade", () => {
    expect(hueVar("blue", "solid")).toBe("var(--hue-blue-solid)");
    expect(hueVar("accent", "soft")).toBe("var(--color-accent-soft)");
  });

  it("rejects anything that is not a hue", () => {
    expect(isHue("violet")).toBe(false);
    expect(isHue("#ff0000")).toBe(false);
    expect(isHue(undefined)).toBe(false);
  });
});

describe("roles", () => {
  const tones = [...HUES, "accent"];

  it("cover every value the schema defines", () => {
    expect(Object.keys(CONCEPT_TYPE_HUE).sort()).toEqual([...CONCEPT_TYPES].sort());
    expect(Object.keys(CALLOUT_HUE).sort()).toEqual([...CALLOUT_KINDS].sort());
    expect(Object.keys(CONNECTOR_HUE).sort()).toEqual([...CONNECTOR_KINDS].sort());
    expect(Object.keys(REQUEST_STATUS_HUE).sort()).toEqual([...RequestStatus.options].sort());
    expect(Object.keys(FILE_STATUS_HUE).sort()).toEqual([...FileStatus.options].sort());
  });

  it("only point at palette hues", () => {
    for (const map of [
      CONCEPT_TYPE_HUE,
      CALLOUT_HUE,
      CONNECTOR_HUE,
      REQUEST_STATUS_HUE,
      FILE_STATUS_HUE,
      SEVERITY_HUE,
      FEEDBACK_HUE,
      RATING_HUE,
      DOCUMENT_HUE,
      STATUS_TONE,
    ]) {
      for (const hue of Object.values(map)) expect(tones).toContain(hue);
    }
  });

  it("keeps practice feedback distinct", () => {
    const values = Object.values(FEEDBACK_HUE);
    expect(new Set(values).size).toBe(values.length);
  });
});
