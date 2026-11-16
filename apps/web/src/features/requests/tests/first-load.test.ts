import { beforeEach, describe, expect, it } from "vitest";
import { baselineSeen, isUnread, readSeen, setFirstLoadCountsAsSeen } from "../model/wording";

describe("the first look on a device", () => {
  beforeEach(() => {
    localStorage.clear();
    setFirstLoadCountsAsSeen(false);
  });

  it("does nothing unless a shell asks for it", () => {
    expect(baselineSeen(["req_a"])).toBe(false);
    expect(readSeen().size).toBe(0);
  });

  it("marks the answers already there as seen, once", () => {
    setFirstLoadCountsAsSeen(true);
    expect(baselineSeen(["req_a", "req_b"])).toBe(true);
    expect(isUnread({ id: "req_a", status: "done" }, readSeen())).toBe(false);
    // a later answer is new again
    expect(baselineSeen(["req_c"])).toBe(false);
    expect(isUnread({ id: "req_c", status: "done" }, readSeen())).toBe(true);
  });
});
