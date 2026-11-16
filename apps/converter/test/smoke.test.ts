import { expect, test, vi } from "vitest";
import { main } from "../src/index.js";

test("placeholder worker logs and returns", () => {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  expect(main()).toContain("placeholder");
  expect(log).toHaveBeenCalledOnce();
});
