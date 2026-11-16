import { expect, test } from "vitest";
import { practice } from "../src/index.js";

test("fill-in markers are shown as gaps, never as raw braces", () => {
  expect(practice.blanksAsGaps("Metoprolol is a {{1}} selective blocker.")).toBe(
    "Metoprolol is a _____ selective blocker.",
  );
  expect(practice.blanksAsGaps("{{1}} and {{12}}")).toBe("_____ and _____");
  expect(practice.blanksAsGaps("No gaps here.")).toBe("No gaps here.");
});
