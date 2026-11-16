/// <reference lib="webworker" />
import type { LayoutInput } from "@notes/schema";
import ELK from "elkjs/lib/elk.bundled.js";
import { computeLayout, type LayoutShape } from "./elk-layout";

/** Runs ELK and the constraint pass off the main thread. */
const elk = new ELK();

self.onmessage = async (
  event: MessageEvent<{ id: number; input: LayoutInput; shape?: LayoutShape }>,
) => {
  const { id, input, shape } = event.data;
  try {
    const result = await computeLayout(input, elk, shape);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
