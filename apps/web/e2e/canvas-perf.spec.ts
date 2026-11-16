import { expect, test } from "@playwright/test";

/**
 * Frame timings while panning and zooming 100 and 300 rich cards, with and
 * without React Flow's only-render-visible mode. Measured with
 * requestAnimationFrame deltas in the page. Run on demand:
 *   CANVAS_PERF=1 pnpm exec playwright test e2e/canvas-perf.spec.ts --project=computer
 */
test.skip(!process.env.CANVAS_PERF, "set CANVAS_PERF=1 to measure");

type Run = { cards: number; culling: boolean; throttle?: number; close?: boolean };
const runs: Run[] = [
  { cards: 100, culling: false },
  { cards: 100, culling: true },
  { cards: 300, culling: false },
  { cards: 300, culling: true },
  // A slower device: CPU throttled four times, whole map and zoomed in.
  { cards: 300, culling: false, throttle: 4 },
  { cards: 300, culling: true, throttle: 4 },
  { cards: 300, culling: false, throttle: 4, close: true },
  { cards: 300, culling: true, throttle: 4, close: true },
];

for (const run of runs) {
  const name = `${run.cards} cards, culling ${run.culling ? "on " : "off"}${run.throttle ? `, CPU ÷${run.throttle}` : ""}${run.close ? ", zoomed in" : ", whole map"}`;
  test(`frame timings: ${name}`, async ({ page }, info) => {
    test.skip(info.project.name !== "computer", "measured on the computer project");
    await page.goto(`/canvas-demo.html?cards=${run.cards}${run.culling ? "&culling=1" : ""}`);
    const view = page.getByTestId("canvas-view");
    await expect(view).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await page.waitForTimeout(1500);
    const layoutMs = await view.getAttribute("data-layout-ms");
    // Zoom so a good share of the map is on screen: the hardest case without culling.
    await page.getByRole("button", { name: /Whole map/ }).click();
    await page.waitForTimeout(500);
    for (let i = 0; i < (run.close ? 4 : 1); i++) {
      await page.getByRole("button", { name: "Zoom in" }).click();
      await page.waitForTimeout(400);
    }
    if (run.throttle) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Emulation.setCPUThrottlingRate", { rate: run.throttle });
    }
    await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __sampling: boolean };
      w.__frames = [];
      w.__sampling = true;
      let last = performance.now();
      const tick = (t: number) => {
        w.__frames.push(t - last);
        last = t;
        if (w.__sampling) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    await page.mouse.move(700, 450);
    for (let i = 0; i < 60; i++) {
      await page.mouse.wheel(i < 30 ? 24 : -24, i % 2 ? 12 : -8);
      await page.waitForTimeout(16);
    }
    await page.keyboard.down("Meta");
    for (let i = 0; i < 30; i++) {
      await page.mouse.wheel(0, i < 15 ? -20 : 20);
      await page.waitForTimeout(16);
    }
    await page.keyboard.up("Meta");
    const frames = await page.evaluate(() => {
      const w = window as unknown as { __frames: number[]; __sampling: boolean };
      w.__sampling = false;
      return w.__frames.slice(2);
    });
    const sorted = [...frames].sort((a, b) => a - b);
    const mean = frames.reduce((s, f) => s + f, 0) / frames.length;
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const max = sorted[sorted.length - 1] ?? 0;
    const slow = frames.filter((f) => f > 20).length;
    const rendered = await page.locator(".react-flow__node-card").count();
    const line = `${name}: layout ${layoutMs} ms; ${frames.length} frames, mean ${mean.toFixed(1)} ms, p95 ${p95.toFixed(1)} ms, max ${max.toFixed(1)} ms, ${slow} over 20 ms; ${rendered} card nodes in the DOM`;
    console.log(line);
    info.annotations.push({ type: "perf", description: line });
    expect(frames.length).toBeGreaterThan(20);
  });
}
