/// <reference lib="webworker" />
import type { LayoutInput } from "@notes/schema";
import ELK from "elkjs/lib/elk.bundled.js";
import { computeLayout } from "./elk-layout";

/** Runs ELK and the constraint pass off the main thread. */
const elk = new ELK();

self.onmessage = async (event: MessageEvent<{ id: number; input: LayoutInput }>) => {
  const { id, input } = event.data;
  try {
    const result = await computeLayout(input, elk);
    self.postMessage({ id, result });
  } catch (error) {
    self.postMessage({ id, error: String(error) });
  }
};
