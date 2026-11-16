import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page } from "@playwright/test";

export const dataDir = resolve(process.env.E2E_BUILT_DIR ?? "../../data/e2e-built");
export const distDir = resolve("dist");

export function credentials(): { username: string; password: string } {
  return JSON.parse(readFileSync(resolve(dataDir, "credentials.json"), "utf8"));
}

/** What the global setup made through the API, so tests can open real records. */
export type Ids = {
  courseId: string;
  lectureId: string;
  /** A document (its library item, which the page addresses use) with a canvas and a waiting request. */
  docNodeId: string;
  /** A second document that only the editor test changes. */
  editNodeId: string;
  editDocId: string;
  fileId: string;
  conceptId: string;
  questionId: string;
  sessionId: string;
};
export const ids = (): Ids => JSON.parse(readFileSync(resolve(dataDir, "ids.json"), "utf8"));

export async function signInBuilt(page: Page) {
  const { username, password } = credentials();
  await page.goto("/login");
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();
}

/**
 * Console messages that are known to be harmless. Anything else the built app logs as an error fails the test.
 * Each entry says why it is allowed.
 */
const harmlessConsole: RegExp[] = [
  // Chromium logs every 401 response; the one from `/api/me` on the sign-in page is the app asking whether she
  // is signed in. A real failure is caught by the script/stylesheet check or by the screen not rendering.
  /Failed to load resource: the server responded with a status of 401/,
];

export type Watch = { problems: string[]; assertClean: (where: string) => void };

/**
 * Collect everything that should never happen in the built app on a page: an uncaught page error, a script or
 * stylesheet that did not load (failed or a non-2xx status), and a console error. Call `assertClean` at the end.
 */
export function watch(page: Page): Watch {
  const problems: string[] = [];
  const assets = ["script", "stylesheet", "font"];
  page.on("pageerror", (error) => problems.push(`page error: ${error.message}`));
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (harmlessConsole.some((pattern) => pattern.test(text))) return;
    problems.push(`console error: ${text}`);
  });
  page.on("requestfailed", (request) => {
    if (assets.includes(request.resourceType())) {
      problems.push(
        `failed ${request.resourceType()}: ${request.url()} (${request.failure()?.errorText})`,
      );
    }
  });
  page.on("response", (response) => {
    const type = response.request().resourceType();
    if (assets.includes(type) && !response.ok()) {
      problems.push(`${type} ${response.status()}: ${response.url()}`);
    }
  });
  return { problems, assertClean: (where) => expect(problems, `problems on ${where}`).toEqual([]) };
}
