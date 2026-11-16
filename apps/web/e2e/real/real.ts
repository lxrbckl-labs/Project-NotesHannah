import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, type TestInfo } from "@playwright/test";

const dataDir = resolve(process.env.E2E_REAL_DIR ?? "../../data/e2e-real");
export const fixture = (name: string) => resolve("../../fixtures/generated", name);

export function credentials(): { username: string; password: string } {
  return JSON.parse(readFileSync(resolve(dataDir, "credentials.json"), "utf8"));
}

export const originOf = (page: Page) => new URL(page.url()).origin;

/** Unique names per project, so the three projects never collide in the one real database. */
export const tag = (info: TestInfo) => info.project.name.replace("real-", "");

export async function signInReal(page: Page) {
  const { username, password } = credentials();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
}

/** Call the real API as the signed-in browser session (same cookie, same Origin rule). */
export async function api<T = unknown>(
  page: Page,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const response = await page.request.fetch(`/api${path}`, {
    method,
    headers: { Origin: originOf(page), "Content-Type": "application/json" },
    data: body === undefined ? undefined : JSON.stringify(body),
  });
  expect(response.status(), `${method} ${path}`).toBeLessThan(300);
  return response.status() === 204 ? (undefined as T) : ((await response.json()) as T);
}

export async function converterOnline(page: Page): Promise<boolean> {
  const res = await page.request.get("/api/converter/status");
  if (!res.ok()) return false;
  return ((await res.json()) as { converter: { state: string } }).converter.state === "online";
}
