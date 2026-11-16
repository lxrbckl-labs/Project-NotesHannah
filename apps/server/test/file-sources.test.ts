import { describe, expect, it } from "vitest";
import { composed } from "./composed.support.js";

describe("the files-backed source lookup", () => {
  it("reports the file name, page number and transcript revision of a page", async () => {
    const t = composed();
    const { file, pages } = await t.convertedFile(t.she, { name: "lecture 7.pdf" });
    const [first, second] = pages;
    const known = (pageId: string, quote = "x") =>
      t.services.sources.resolve(t.alice, [{ fileId: file.id, pageId, quote }])[0];
    expect(known(first?.id as string)).toMatchObject({
      known: true,
      exists: true,
      trashed: false,
      fileName: "lecture 7.pdf",
      pageIndex: 1,
      currentTranscriptRevision: null,
    });
    expect(known(second?.id as string)).toMatchObject({ pageIndex: 2 });

    t.services.files.saveTranscript(t.bot, {
      pageId: first?.id as string,
      text: "Atenolol blocks\n  beta-1 receptors.",
      flags: [],
    });
    expect(known(first?.id as string, "blocks beta-1 receptors")).toMatchObject({
      currentTranscriptRevision: 1,
      quoteFound: true,
    });
  });

  it("matches quotes against the current transcript, whitespace-normalised", async () => {
    const t = composed();
    const { file, pages } = await t.convertedFile(t.she, { pages: 2 });
    const page = pages[1]?.id as string; // no native text on page 2 of the fake converter
    const ask = (quote: string) =>
      t.services.sources.resolve(t.alice, [{ fileId: file.id, pageId: page, quote }])[0];
    // No text at all yet: unknown, not false (an agent may cite once it has transcribed).
    expect(ask("anything")?.quoteFound).toBeNull();

    t.services.files.saveTranscript(t.bot, {
      pageId: page,
      text: "Dose: 25 mg\nPO   BID",
      flags: [],
    });
    expect(ask("25 mg PO BID")?.quoteFound).toBe(true);
    expect(ask("  Dose: 25 mg  ")?.quoteFound).toBe(true);
    expect(ask("50 mg")?.quoteFound).toBe(false);
    expect(ask("   ")?.quoteFound).toBe(false);

    // The newest revision is the one that counts.
    t.services.files.saveTranscript(t.bot, { pageId: page, text: "Dose: 50 mg", flags: [] });
    expect(ask("25 mg PO BID")).toMatchObject({ quoteFound: false, currentTranscriptRevision: 2 });
    expect(ask("50 mg")?.quoteFound).toBe(true);
  });

  it("also finds quotes in native slide text and speaker notes, before any transcript", async () => {
    const t = composed();
    const { file, pages } = await t.convertedFile(t.she, {
      mutate: (result) => {
        result.pages[1].speakerNotes = "Remember: titrate slowly";
      },
    });
    const ask = (page: number, quote: string) =>
      t.services.sources.resolve(t.alice, [
        { fileId: file.id, pageId: pages[page]?.id as string, quote },
      ])[0];
    expect(ask(0, "Slide 1 text")).toMatchObject({
      quoteFound: true,
      currentTranscriptRevision: null,
    });
    expect(ask(0, "Slide 9 text")?.quoteFound).toBe(false);
    expect(ask(1, "titrate   slowly")?.quoteFound).toBe(true);
    // Once transcribed, the transcript is still checked, and the slide text still counts.
    t.services.files.saveTranscript(t.bot, {
      pageId: pages[0]?.id as string,
      text: "Written",
      flags: [],
    });
    expect(ask(0, "Written")?.quoteFound).toBe(true);
    expect(ask(0, "Slide 1 text")?.quoteFound).toBe(true);
  });

  it("a page that does not belong to the file, or to the user, does not exist", async () => {
    const t = composed();
    const a = await t.convertedFile(t.she);
    const b = await t.convertedFile(t.she);
    const theirs = await t.convertedFile(t.bobUser);
    const [wrongFile, theirPage, unknown] = t.services.sources.resolve(t.alice, [
      { fileId: a.file.id, pageId: b.pages[0]?.id as string, quote: "q" },
      { fileId: theirs.file.id, pageId: theirs.pages[0]?.id as string, quote: "q" },
      { fileId: a.file.id, pageId: "pag_01HZX3K9Q2V7M4N8P6R5T0W1YB", quote: "q" },
    ]);
    for (const info of [wrongFile, theirPage, unknown]) {
      expect(info).toMatchObject({ known: true, exists: false, fileName: null, pageIndex: null });
    }
    // And bob sees alice's page as missing too.
    const seen = t.services.sources.resolve(t.bob, [
      { fileId: a.file.id, pageId: a.pages[0]?.id as string, quote: "q" },
    ])[0];
    expect(seen?.exists).toBe(false);
  });

  it("trashed files still exist but say so; deleted ones stop existing", async () => {
    const t = composed();
    const { file, pages } = await t.convertedFile(t.she);
    const ref = { fileId: file.id, pageId: pages[0]?.id as string, quote: "Slide 1 text" };
    const resolve = () => t.services.sources.resolve(t.alice, [ref])[0];
    t.services.files.trash(t.she, file.id);
    expect(resolve()).toMatchObject({ exists: true, trashed: true, quoteFound: true });
    t.services.files.restore(t.she, file.id);
    expect(resolve()?.trashed).toBe(false);
    t.services.files.trash(t.she, file.id);
    t.services.files.permanentDelete(t.she, file.id);
    expect(resolve()).toMatchObject({ known: true, exists: false });
  });

  it("says whether a page or file exists for the user, which the reverse lookup turns into not_found", async () => {
    const t = composed();
    const mine = await t.convertedFile(t.she);
    const page = mine.pages[0]?.id as string;
    const exists = (userId: string, target: { pageId: string } | { fileId: string }) =>
      t.services.sources.exists?.(userId, target);
    expect(exists(t.alice, { pageId: page })).toBe(true);
    expect(exists(t.alice, { fileId: mine.file.id })).toBe(true);
    expect(exists(t.bob, { pageId: page })).toBe(false);
    expect(exists(t.bob, { fileId: mine.file.id })).toBe(false);
    expect(exists(t.alice, { pageId: "pag_01HZX3K9Q2V7M4N8P6R5T0W1YB" })).toBe(false);
    expect(() => t.services.documents.citedBy(t.she, { pageId: page })).not.toThrow();
    expect(() => t.services.documents.citedBy(t.bobUser, { pageId: page })).toThrow(/No such page/);
    expect(() => t.services.documents.citedBy(t.bobUser, { fileId: mine.file.id })).toThrow(
      /No such file/,
    );
    // Trashed files still exist for the lookup; deleted ones do not.
    t.services.files.trash(t.she, mine.file.id);
    expect(exists(t.alice, { pageId: page })).toBe(true);
    t.services.files.permanentDelete(t.she, mine.file.id);
    expect(exists(t.alice, { pageId: page })).toBe(false);
  });
});
