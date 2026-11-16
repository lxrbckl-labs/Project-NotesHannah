import { expect, test } from "@playwright/test";
import { api, converterOnline, credentials, fixture, signInReal, tag } from "./real";

/**
 * The main journeys against the real server, in order: each builds on the one before, inside one
 * browser context per project. The conversion steps need the real converter container; without
 * Docker they skip with a visible reason, and everything that does not need conversion still runs.
 */
test.describe.configure({ mode: "serial" });

test("sign in: a wrong password is refused clearly, the right one gets in, signing out ends the session", async ({
  page,
}) => {
  await page.goto("/library");
  await expect(page).toHaveURL(/\/login/);
  const { username, password } = credentials();
  await page.getByLabel("Username").fill(username);
  await page.getByLabel("Password").fill("definitely-not-it");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("alert")).toContainText("username or password is not right");
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "Library" })).toBeVisible();

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
  const me = await page.request.get("/api/me");
  expect(me.status()).toBe(401);
});

test("the library: create a term, a course (five sections) and a lecture, rename and favourite", async ({
  page,
}, info) => {
  await signInReal(page);
  const t = tag(info);
  await page.getByRole("main").getByRole("button", { name: "New term" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill(`Term ${t}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Term ${t}` })).toBeVisible();

  await page.getByRole("button", { name: "New course" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill(`Course ${t}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByRole("heading", { level: 1, name: `Course ${t}` })).toBeVisible();
  const sections = page.getByRole("list", { name: "Sections" }).getByRole("link");
  await expect(sections).toHaveCount(5);
  await expect(sections).toContainText([
    "Sources",
    "Lectures",
    "Study guides",
    "Practice",
    "Exams",
  ]);

  await page
    .getByRole("list", { name: "Sections" })
    .getByRole("link", { name: /^Lectures/ })
    .click();
  await page.getByRole("button", { name: "New lecture" }).first().click();
  await page.getByLabel("Name", { exact: true }).fill(`Beta blockers ${t}`);
  await page.getByRole("button", { name: "Create" }).click();
  await expect(page.getByText(new RegExp(`01 · Beta blockers ${t} · `))).toBeVisible();

  // rename in place, then it is still renamed after a reload (the server kept it)
  // the new row settles once the server has answered (a click on the placeholder would be lost)
  await page.waitForLoadState("networkidle");
  await page.getByRole("button", { name: `Actions for Beta blockers ${t}` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  const input = page.getByRole("textbox", { name: `Rename Beta blockers ${t}` });
  await input.fill(`Beta blockers II ${t}`);
  await input.press("Enter");
  await expect(page.getByText(new RegExp(`Beta blockers II ${t}`))).toBeVisible();
  await page.reload();
  await expect(page.getByText(new RegExp(`Beta blockers II ${t}`))).toBeVisible();

  // a rule the server enforces is reported with its message
  await page.getByRole("button", { name: `Actions for Beta blockers II ${t}` }).click();
  await page.getByRole("menuitem", { name: "Add to favourites" }).click();
  await page.getByRole("link", { name: "Library", exact: true }).first().click();
  await expect(
    page
      .getByRole("region", { name: "Favourites" })
      .getByRole("link", { name: new RegExp(`Beta blockers II ${t}`) }),
  ).toBeVisible();
});

test("upload a real file, watch the real converter turn it into pages, and open the source viewer", async ({
  page,
}, info) => {
  await signInReal(page);
  test.skip(
    !(await converterOnline(page)),
    "Docker is not running, so the converter container is not available: conversion is not asserted.",
  );
  const t = tag(info);
  await page.goto("/library");
  const tree = page.getByRole("tree", { name: "All files" });
  await tree.getByRole("button", { name: `Expand Course ${t}` }).click();
  await tree
    .locator("li")
    .filter({ has: page.getByRole("treeitem", { name: `Course ${t}`, exact: true }) })
    .last()
    .getByRole("treeitem", { name: "Lectures", exact: true })
    .click();
  await page
    .getByRole("list", { name: "Contents" })
    .getByRole("link", { name: new RegExp(`Beta blockers II ${t}`) })
    .click();

  // a lecture opens as its document; its source files and the upload button are on its library page
  await page.getByRole("link", { name: "Sources" }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).click();
  await (await chooser).setFiles(fixture("lecture.pptx"));
  await expect(page.getByTestId("upload-item")).toHaveAttribute("data-status", "done");

  const row = page.getByTestId("file-row").filter({ hasText: "lecture.pptx" });
  await expect(row).toBeVisible();
  await expect(row).toHaveAttribute("data-status", "converted", { timeout: 90_000 });
  await expect(row).toContainText("12 pages");

  await row.getByRole("link", { name: "lecture.pptx" }).click();
  await expect(page.getByRole("heading", { level: 1, name: "lecture.pptx" })).toBeVisible();
  await expect(page.getByTestId("thumb")).toHaveCount(12);
  await expect(page.getByTestId("page-position")).toContainText("Page 1 of 12");
  // the real page image loads
  const image = page.getByRole("img", { name: "Page 1" });
  await expect(image).toBeVisible();
  await expect
    .poll(() => image.evaluate((el: HTMLImageElement) => el.naturalWidth))
    .toBeGreaterThan(100);
  await page.getByRole("button", { name: "Next page" }).click();
  await expect(page.getByTestId("page-position")).toContainText("Page 2 of 12");
  const download = page.getByRole("link", { name: /Download original/ });
  const bytes = await page.request.get((await download.getAttribute("href")) as string);
  expect(bytes.status()).toBe(200);
});

test("transcripts: an agent-style save shows flags and unverified, she reviews it and restores a revision", async ({
  page,
}, info) => {
  await signInReal(page);
  test.skip(
    !(await converterOnline(page)),
    "Docker is not running, so the converter container is not available: there are no pages to transcribe.",
  );
  const files = (
    await api<{ items: Array<{ id: string; originalName: string }> }>(
      page,
      "GET",
      "/files?limit=100",
    )
  ).items;
  const file = files.find((f) => f.originalName === "lecture.pptx");
  expect(file, "the uploaded lecture.pptx").toBeTruthy();
  const pages = (
    await api<{ items: Array<{ id: string }> }>(page, "GET", `/files/${file?.id}/pages`)
  ).items;
  const first = pages[0]?.id as string;
  await api(page, "PUT", `/pages/${first}/transcript`, {
    text: "Metoprolol 5O mg PO BID",
    flags: [{ kind: "uncertain", quote: "5O mg", note: "Is this 50?" }],
  });
  await api(page, "PUT", `/pages/${first}/transcript`, {
    text: "Metoprolol 50 mg PO BID",
    flags: [{ kind: "dose", quote: "50 mg" }],
  });

  await page.goto(`/files/${file?.id}?page=${first}&quote=${encodeURIComponent("PO BID")}`);
  if (info.project.name === "real-phone")
    await expect(page.getByRole("tab", { name: "Transcript" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  await expect(page.locator("mark[data-flag=dose]")).toHaveText(/50 mg/);
  await expect(page.locator("mark[data-quote=true]")).toHaveText("PO BID");
  await expect(page.getByText("Unverified", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mark as reviewed" }).click();
  await expect(page.getByText("Reviewed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /History/ }).click();
  await expect(page.getByTestId("revision")).toHaveCount(2);
  await page.getByRole("button", { name: "Restore revision 1" }).click();
  await expect(page.getByTestId("revision")).toHaveCount(3);
  await expect(page.getByTestId("transcript-text")).toContainText("5O mg");
});

test("search finds the transcript and opens the viewer on that page", async ({ page }) => {
  await signInReal(page);
  test.skip(
    !(await converterOnline(page)),
    "Docker is not running, so the converter container is not available: no transcript to search.",
  );
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await page.getByTestId("tab-bar").getByRole("link", { name: "Search" }).click();
  } else {
    await page.keyboard.press("Control+k");
  }
  await page.getByRole("searchbox", { name: "Search your library" }).fill("metoprolol");
  const hit = page
    .getByTestId("results-page")
    .getByRole("link")
    .filter({ hasText: "lecture.pptx" })
    .first();
  await expect(hit).toContainText("lecture.pptx");
  await hit.click();
  await expect(page.getByTestId("source-viewer")).toBeVisible();
  await expect(page.locator("mark[data-quote=true]").first()).toHaveText(/etoprolol/i);
});

test("the picker accepts every type the server reads (HEIC too), and the server's refusals are explained", async ({
  page,
}) => {
  await signInReal(page);
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).first().click();
  const picker = await chooser;
  // several files at once, one of each kind the server accepts, and one it does not
  await picker.setFiles([
    fixture("photo.heic"),
    fixture("text-layer.pdf"),
    fixture("encrypted-userpw.pdf"),
    fixture("other-office.docx"),
  ]);
  const items = page.getByTestId("upload-item");
  await expect(items).toHaveCount(4);
  await expect(items.filter({ hasText: "other-office.docx" })).toHaveAttribute(
    "data-status",
    "error",
  );
  await expect(items.filter({ hasText: "other-office.docx" }).getByRole("alert")).toContainText(
    "not a file type the app can read",
  );
  for (const name of ["photo.heic", "text-layer.pdf", "encrypted-userpw.pdf"]) {
    await expect(items.filter({ hasText: name })).toHaveAttribute("data-status", "done");
  }
  if (await converterOnline(page)) {
    await expect(
      page.getByTestId("file-row").filter({ hasText: "photo.heic" }).first(),
    ).toHaveAttribute("data-status", "converted", { timeout: 90_000 });
    const locked = page.getByTestId("file-row").filter({ hasText: "encrypted-userpw.pdf" }).first();
    await expect(locked).toHaveAttribute("data-status", "failed", { timeout: 90_000 });
    await expect(locked).toContainText("password protected");
    await expect(locked.getByRole("button", { name: "Retry encrypted-userpw.pdf" })).toBeVisible();
  }
});

test("file a source: from the inbox to a lecture and back, with the sheet", async ({
  page,
}, info) => {
  await signInReal(page);
  const t = tag(info);
  // an unconverted-agnostic file: upload a photo straight to the inbox through the UI
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "Upload files" }).first().click();
  await (await chooser).setFiles(fixture("photo-exif6.jpg"));
  const row = page.getByTestId("file-row").filter({ hasText: "photo-exif6.jpg" }).first();
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: /File photo-exif6.jpg under/ }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: `Expand Term ${t}` }).click();
  await sheet.getByRole("button", { name: `Expand Course ${t}` }).click();
  await sheet.getByRole("button", { name: "Expand Lectures" }).click();
  // a course is not a place for a file; the lecture is
  await expect(sheet.getByRole("button", { name: `Course ${t}`, exact: true })).toBeDisabled();
  await sheet.getByRole("button", { name: new RegExp(`Beta blockers II ${t}`) }).click();
  await sheet.getByRole("button", { name: "File here" }).click();
  await expect(page.getByText(/Filed "photo-exif6.jpg"/)).toBeVisible();
  const filed = (
    await api<{ items: Array<{ originalName: string; nodeId: string | null }> }>(
      page,
      "GET",
      "/files?limit=100",
    )
  ).items.filter((f) => f.originalName === "photo-exif6.jpg");
  expect(filed.some((f) => f.nodeId !== null)).toBe(true);
});

test("trash and restore: a lecture goes to the trash, comes back, and its files return to the inbox meanwhile", async ({
  page,
}, info) => {
  await signInReal(page);
  const t = tag(info);
  const found = await api<{ items: Array<{ kind: string; node?: { id: string; name: string } }> }>(
    page,
    "GET",
    `/search?q=${encodeURIComponent(`Beta blockers II ${t}`)}&kinds=node`,
  );
  const lectureId = found.items.find((h) => h.kind === "node")?.node?.id as string;
  await page.goto(`/library/${lectureId}`);
  await page.getByRole("button", { name: /More actions for Beta blockers II/ }).click();
  await page.getByRole("menuitem", { name: "Move to trash" }).click();
  await expect(page.getByText(/to the trash/)).toBeVisible();

  const asTrashed = await api<{ items: Array<{ id: string }> }>(page, "GET", "/trash");
  expect(asTrashed.items.some((n) => n.id === lectureId)).toBe(true);
  // the server sends filed sources back to the inbox instead of trashing them
  await page.getByRole("link", { name: "Inbox", exact: true }).click();
  await expect(
    page.getByTestId("file-row").filter({ hasText: "photo-exif6.jpg" }).first(),
  ).toBeVisible();

  await page.goto("/trash");
  await page.getByRole("button", { name: new RegExp(`^Restore Beta blockers II ${t}`) }).click();
  await expect(
    page.getByTestId("trash-row").filter({ hasText: `Beta blockers II ${t}` }),
  ).toHaveCount(0);
  await page.goto(`/library/${lectureId}`);
  await expect(
    page.getByRole("heading", { level: 1, name: new RegExp(`Beta blockers II ${t}`) }),
  ).toBeVisible();
});

test("API keys: create one (secret shown once), revoke it; theme sticks", async ({
  page,
}, info) => {
  await signInReal(page);
  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "New key" }).click();
  const dialog = page.getByRole("dialog", { name: "New API key" });
  await dialog.getByLabel("Name", { exact: true }).fill(`Agent ${tag(info)}`);
  await dialog.getByLabel(/Read and write/).check();
  await dialog.getByRole("button", { name: "Create key" }).click();
  await expect(page.getByTestId("api-secret")).toHaveText(/^nh_write_[A-Za-z0-9_-]{43}$/);
  await expect(page.getByRole("alert")).toContainText("You will not see this again");
  await page.getByRole("button", { name: "I have saved it" }).click();
  const row = page.getByTestId("key-row").filter({ hasText: `Agent ${tag(info)}` });
  await expect(row).toContainText("Never used");
  await row.getByRole("button", { name: `Revoke Agent ${tag(info)}` }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Revoke key" }).click();
  await expect(row).toContainText("Revoked");

  await page.getByRole("radio", { name: "Dark", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radio", { name: "System", exact: true }).click();
});
