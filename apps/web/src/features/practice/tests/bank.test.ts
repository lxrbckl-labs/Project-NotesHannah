import { expect, test } from "vitest";
import { BANK } from "../store/bank";

test("bank loads and covers every type", () => {
  expect(BANK.length).toBeGreaterThanOrEqual(38);
  const types = new Set(BANK.map((q) => q.type));
  expect(types.size).toBe(8);
});
