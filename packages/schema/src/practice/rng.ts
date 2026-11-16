import { z } from "zod";

/**
 * Seeds are unsigned 32-bit integers. Everything random in practice (variant
 * numbers, option shuffles, session order) is drawn from a seed, so the same
 * seed always gives the same result on every machine.
 */
export const RandomSeed = z.number().int().min(0).max(4_294_967_295);
export type RandomSeed = z.infer<typeof RandomSeed>;

/** A function returning numbers in [0, 1), like Math.random but repeatable. */
export type Rng = () => number;

/** FNV-1a hash of the parts, as an unsigned 32-bit integer. */
export function hashSeed(...parts: Array<string | number>): number {
  let h = 0x811c9dc5;
  const text = parts.map(String).join("\u0001");
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** A new seed derived from a base seed and some labels (for example a question id). */
export function deriveSeed(base: number, ...parts: Array<string | number>): number {
  return hashSeed(base, ...parts);
}

/** Mulberry32: a small, well-behaved seeded generator. */
export function makeRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
}

/** A shuffled copy (Fisher-Yates); the input is not changed. */
export function shuffled<T>(items: readonly T[], rng: Rng): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const a = out[i] as T;
    out[i] = out[j] as T;
    out[j] = a;
  }
  return out;
}
