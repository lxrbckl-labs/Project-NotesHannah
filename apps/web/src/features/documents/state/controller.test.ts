import { describe, expect, it } from "vitest";
import { patchContent, splitTextBlock } from "../model/gestures";
import { GUIDE_ID } from "../store/fixture";
import { MockDocumentStore } from "../store/mock-store";
import { DocumentController } from "./controller";

async function setup(options: ConstructorParameters<typeof MockDocumentStore>[0] = {}) {
  const store = new MockDocumentStore({ latency: 0, ...options });
  const controller = new DocumentController(store, GUIDE_ID);
  await controller.load();
  return { store, controller };
}

const textOf = (controller: DocumentController, id: string) =>
  (controller.state.doc?.blocks.find((b) => b.id === id)?.content as { text: unknown } | undefined)
    ?.text;

describe("DocumentController", () => {
  it("applies an edit at once and confirms it", async () => {
    const { store, controller } = await setup();
    const id = controller.state.doc?.blocks.find((b) => b.type === "paragraph")?.id as string;
    controller.perform(patchContent(GUIDE_ID, id, { text: [{ text: "Edited" }] }), "Edit");
    expect(textOf(controller, id)).toEqual([{ text: "Edited" }]);
    expect(controller.state.saveStatus).toBe("saving");
    await controller.idle();
    expect(controller.state.saveStatus).toBe("saved");
    const saved = await store.loadDocument(GUIDE_ID);
    expect(saved.revision).toBe(5);
    expect(saved.blocks.find((b) => b.id === id)?.origin).toBe("user");
  });

  it("rolls back a failed write and keeps it for retry", async () => {
    const { store, controller } = await setup();
    const block = controller.state.doc?.blocks.find((b) => b.type === "paragraph");
    const id = block?.id as string;
    const original = textOf(controller, id);
    store.failNext = 1;
    controller.perform(patchContent(GUIDE_ID, id, { text: [{ text: "Lost?" }] }), "Edit");
    expect(textOf(controller, id)).toEqual([{ text: "Lost?" }]);
    await controller.idle();
    expect(textOf(controller, id)).toEqual(original);
    expect(controller.state.saveStatus).toBe("failed");
    expect(controller.state.error).toMatch(/undone/);
    expect(controller.state.failed).toHaveLength(1);
    controller.retry();
    expect(textOf(controller, id)).toEqual([{ text: "Lost?" }]);
    await controller.idle();
    expect(controller.state.saveStatus).toBe("saved");
    expect((await store.loadDocument(GUIDE_ID)).blocks.find((b) => b.id === id)?.content).toEqual({
      text: [{ text: "Lost?" }],
    });
  });

  it("maps client IDs of inserted blocks to the server's for later writes", async () => {
    const { store, controller } = await setup();
    const block = controller.state.doc?.blocks.find((b) => b.type === "paragraph");
    if (!block) throw new Error("no paragraph");
    const clientId = "blk_01JC0000000000000000005555";
    controller.perform(
      splitTextBlock(GUIDE_ID, block, [{ text: "a" }], [{ text: "b" }], clientId),
      "Split",
    );
    controller.perform(patchContent(GUIDE_ID, clientId, { text: [{ text: "b2" }] }), "Edit");
    await controller.idle();
    const serverId = controller.idMap.get(clientId) as string;
    expect(serverId).toMatch(/^blk_/);
    expect(serverId).not.toBe(clientId);
    const saved = await store.loadDocument(GUIDE_ID);
    expect(saved.blocks.find((b) => b.id === serverId)?.content).toEqual({
      text: [{ text: "b2" }],
    });
  });

  it("undoes and redoes, including an insert", async () => {
    const { store, controller } = await setup();
    const block = controller.state.doc?.blocks.find((b) => b.type === "paragraph");
    if (!block) throw new Error("no paragraph");
    const count = controller.state.doc?.blocks.length as number;
    controller.perform(splitTextBlock(GUIDE_ID, block, [{ text: "a" }], [{ text: "b" }]), "Split");
    expect(controller.state.doc?.blocks).toHaveLength(count + 1);
    controller.undo();
    expect(controller.state.doc?.blocks).toHaveLength(count);
    expect(textOf(controller, block.id)).toEqual(block.content.text);
    controller.redo();
    expect(controller.state.doc?.blocks).toHaveLength(count + 1);
    await controller.idle();
    expect((await store.loadDocument(GUIDE_ID)).blocks).toHaveLength(count + 1);
  });

  it("marks reviewed, counts down, and can undo it", async () => {
    const { controller } = await setup();
    const unverified = () =>
      controller.state.doc?.blocks.filter(
        (b) => b.type !== "divider" && b.review.status === "unverified",
      ).length;
    const before = unverified() as number;
    const target = controller.state.doc?.blocks.find((b) => b.review.status === "unverified")
      ?.id as string;
    controller.review("reviewed", [target]);
    expect(unverified()).toBe(before - 1);
    await controller.idle();
    controller.undo();
    expect(unverified()).toBe(before);
    controller.review("reviewed");
    expect(unverified()).toBe(0);
  });

  it("reports a conflict and asks for a reload instead of retrying", async () => {
    const { store, controller } = await setup();
    // Someone else writes first.
    const other = new DocumentController(store, GUIDE_ID);
    await other.load();
    const id = controller.state.doc?.blocks[2]?.id as string;
    other.perform(patchContent(GUIDE_ID, id, { text: [{ text: "agent" }] }), "Edit");
    await other.idle();
    controller.perform(patchContent(GUIDE_ID, id, { text: [{ text: "her" }] }), "Edit");
    await controller.idle();
    expect(controller.state.conflict).toBe(true);
    expect(controller.state.failed).toHaveLength(0);
    expect(controller.state.error).toMatch(/Reload/);
  });

  it("refuses a change that would break the schema, leaving the document alone", async () => {
    const { controller } = await setup();
    const id = controller.state.doc?.blocks.find((b) => b.type === "heading")?.id as string;
    const ok = controller.perform(patchContent(GUIDE_ID, id, { level: 7 }), "Edit");
    expect(ok).toBe(false);
    expect(controller.state.pending).toHaveLength(0);
    expect(controller.state.error).toMatch(/isn't allowed/);
  });

  it("restores a revision and reloads", async () => {
    const { controller } = await setup();
    await controller.restore(1);
    expect(controller.state.doc?.revision).toBe(5);
    expect(controller.state.doc?.blocks.some((b) => b.type === "drug_card")).toBe(false);
  });
});
