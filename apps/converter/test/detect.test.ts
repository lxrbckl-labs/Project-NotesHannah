import { describe, expect, test } from "vitest";
import { isPresentationContentTypes, sniff } from "../src/convert/detect.js";
import { cleanMessage } from "../src/errors.js";
import { type ProcInfo, treeOf } from "../src/proc.js";

describe("sniff", () => {
  test.each([
    ["jpeg", Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])],
    ["png", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])],
    ["pdf", Buffer.from("%PDF-1.7\n")],
    ["pdf", Buffer.concat([Buffer.alloc(100, 0x20), Buffer.from("%PDF-1.4")])],
    ["zip", Buffer.from([0x50, 0x4b, 3, 4, 0, 0])],
    ["ole", Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0])],
    [
      "heic",
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypheic"), Buffer.alloc(12)]),
    ],
    [
      "heic",
      Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from("ftypmif1"),
        Buffer.alloc(4),
        Buffer.from("heic"),
      ]),
    ],
    [
      "unknown",
      Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from("ftypmp42"), Buffer.alloc(12)]),
    ],
    ["unknown", Buffer.from("just some text")],
    ["unknown", Buffer.alloc(0)],
  ] as const)("%s", (want, bytes) => {
    expect(sniff(bytes)).toBe(want);
  });
});

describe("isPresentationContentTypes", () => {
  const ct = (type: string) =>
    `<Types><Override PartName="/ppt/presentation.xml" ContentType="${type}"/></Types>`;
  test.each([
    [
      "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml",
      true,
      false,
    ],
    [
      "application/vnd.openxmlformats-officedocument.presentationml.slideshow.main+xml",
      true,
      false,
    ],
    ["application/vnd.ms-powerpoint.presentation.macroEnabled.main+xml", true, true],
    [
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml",
      false,
      false,
    ],
  ])("%s", (type, ok, macroEnabled) => {
    expect(isPresentationContentTypes(ct(type))).toEqual({ ok, macroEnabled });
  });
  test("no presentation override means not a presentation", () => {
    expect(isPresentationContentTypes("<Types/>").ok).toBe(false);
  });
});

describe("cleanMessage", () => {
  test("strips control characters and caps length", () => {
    expect(cleanMessage("a\u0000b\nc\u001b[31m")).toBe("a b c [31m");
    expect(cleanMessage("x".repeat(1000)).length).toBe(300);
  });
});

describe("treeOf", () => {
  test("collects the root and all descendants only", () => {
    const p = (pid: number, ppid: number): ProcInfo => ({ pid, ppid, rssBytes: 1 });
    const procs = [p(1, 0), p(10, 1), p(11, 10), p(12, 11), p(13, 10), p(20, 1)];
    expect(
      treeOf(procs, 10)
        .map((x) => x.pid)
        .sort(),
    ).toEqual([10, 11, 12, 13]);
    expect(treeOf(procs, 999)).toEqual([]);
  });
});
