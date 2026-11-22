import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { Dispatcher, isTypingTarget, SEQUENCE_MS } from "./dispatch";
import { HOTKEY_BY_ID } from "./registry";

let clock = 0;
let overlay: Element | null = null;
let dispatcher: Dispatcher;
let last: string | null = null;
const listen = (event: KeyboardEvent) => {
  last = dispatcher.handle(event);
};

beforeEach(() => {
  clock = 1000;
  overlay = null;
  last = null;
  dispatcher = new Dispatcher(
    HOTKEY_BY_ID,
    () => clock,
    () => overlay,
  );
  window.addEventListener("keydown", listen);
  document.body.innerHTML = "";
});
afterEach(() => window.removeEventListener("keydown", listen));

/** Press a key on an element (the body by default) and say what the dispatcher did. */
function press(
  key: string,
  options: KeyboardEventInit = {},
  target: HTMLElement = document.body,
): { result: string | null; event: KeyboardEvent } {
  const code = /^[a-z]$/i.test(key) ? `Key${key.toUpperCase()}` : undefined;
  const event = new KeyboardEvent("keydown", {
    key,
    ...(code ? { code } : {}),
    bubbles: true,
    cancelable: true,
    ...options,
  });
  last = null;
  target.dispatchEvent(event);
  return { result: last, event };
}

function field(html: string): HTMLElement {
  document.body.innerHTML = html;
  return document.body.firstElementChild as HTMLElement;
}

describe("the typing guard", () => {
  test("text fields, selects and editable blocks count as typing; buttons and checkboxes do not", () => {
    expect(isTypingTarget(field("<input type='text'>"))).toBe(true);
    expect(isTypingTarget(field("<input type='search'>"))).toBe(true);
    expect(isTypingTarget(field("<textarea></textarea>"))).toBe(true);
    expect(isTypingTarget(field("<select></select>"))).toBe(true);
    expect(isTypingTarget(field("<div contenteditable='true'><p>hi</p></div>"))).toBe(true);
    expect(isTypingTarget(field("<button>Go</button>"))).toBe(false);
    expect(isTypingTarget(field("<input type='checkbox'>"))).toBe(false);
    expect(isTypingTarget(field("<input type='radio'>"))).toBe(false);
    expect(isTypingTarget(document.body)).toBe(false);
  });

  test("a single key does nothing while she types; a Command or Ctrl combination still works", () => {
    const run = vi.fn();
    const find = vi.fn();
    dispatcher.register({ id: "app.ask", run });
    dispatcher.register({ id: "app.quickFind", run: find });
    const input = field("<input type='text'>");
    expect(press("r", {}, input).result).toBeNull();
    expect(press("/", {}, input).result).toBeNull();
    expect(run).not.toHaveBeenCalled();
    expect(press("k", { metaKey: true }, input).result).toBe("app.quickFind");
    expect(press("k", { ctrlKey: true }, input).result).toBe("app.quickFind");
    expect(find).toHaveBeenCalledTimes(2);
    expect(press("r").result).toBe("app.ask");
  });

  test("inside an editable block, nested elements count too", () => {
    const run = vi.fn();
    dispatcher.register({ id: "doc.mode", run });
    const block = field("<div contenteditable='true'><p><strong>bold</strong></p></div>");
    const inner = block.querySelector("strong") as HTMLElement;
    expect(press("e", {}, inner).result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("dialogs and menus", () => {
  test("single keys wait while a dialog is open; the dialog's own keys and Mod combos do not", () => {
    const ask = vi.fn();
    dispatcher.register({ id: "app.ask", run: ask });
    dispatcher.register({ id: "app.quickFind", run: () => {} });
    overlay = document.createElement("div");
    expect(press("r").result).toBeNull();
    expect(ask).not.toHaveBeenCalled();
    // Quick find belongs to its own dialog: Command K closes it again.
    expect(press("k", { metaKey: true }).result).toBe("app.quickFind");
    overlay = null;
    expect(press("r").result).toBe("app.ask");
  });

  test("a key another handler already took is left alone", () => {
    const run = vi.fn();
    dispatcher.register({ id: "app.ask", run });
    const button = field("<button>x</button>");
    button.addEventListener("keydown", (e) => e.preventDefault());
    expect(press("r", {}, button).result).toBeNull();
    expect(run).not.toHaveBeenCalled();
  });
});

describe("pairs", () => {
  test("G then L runs the pair, and the second key goes nowhere else", () => {
    const library = vi.fn();
    dispatcher.register({ id: "go.library", run: library });
    const first = press("g");
    expect(first.result).toBe("pending");
    expect(first.event.defaultPrevented).toBe(true);
    clock += 300;
    const second = press("l");
    expect(second.result).toBe("go.library");
    expect(second.event.defaultPrevented).toBe(true);
    expect(library).toHaveBeenCalledOnce();
  });

  test("too slow, and the pair is forgotten", () => {
    const library = vi.fn();
    dispatcher.register({ id: "go.library", run: library });
    press("g");
    clock += SEQUENCE_MS + 1;
    expect(press("l").result).toBeNull();
    expect(library).not.toHaveBeenCalled();
  });

  test("a key that is not the second of any pair is handled on its own", () => {
    const ask = vi.fn();
    dispatcher.register({ id: "go.library", run: () => {} });
    dispatcher.register({ id: "app.ask", run: ask });
    press("g");
    expect(press("r").result).toBe("app.ask");
    // And the pair does not linger: L alone now does nothing.
    expect(press("l").result).toBeNull();
  });

  test("G does nothing while she types", () => {
    dispatcher.register({ id: "go.library", run: () => {} });
    const input = field("<input>");
    expect(press("g", {}, input).result).toBeNull();
  });
});

describe("matching", () => {
  test("Shift is part of a letter's key; '?' needs no Shift spelled out", () => {
    const term = vi.fn();
    const keys = vi.fn();
    dispatcher.register({ id: "library.newTerm", run: term });
    dispatcher.register({ id: "app.shortcuts", run: keys });
    expect(press("t").result).toBeNull();
    expect(press("T", { shiftKey: true }).result).toBe("library.newTerm");
    expect(press("?", { shiftKey: true }).result).toBe("app.shortcuts");
    expect(term).toHaveBeenCalledOnce();
    expect(keys).toHaveBeenCalledOnce();
  });

  test("Option on a Mac types a symbol: the key's place is read instead", () => {
    const notes = vi.fn();
    dispatcher.register({ id: "doc.notes", run: notes });
    expect(press("˜", { altKey: true, code: "KeyN" }).result).toBe("doc.notes");
    expect(notes).toHaveBeenCalledOnce();
  });

  test("a held key repeats only where that is useful", () => {
    const zoom = vi.fn();
    const ask = vi.fn();
    dispatcher.register({ id: "source.zoomIn", run: zoom });
    dispatcher.register({ id: "app.ask", run: ask });
    press("=", { repeat: true });
    press("r", { repeat: true });
    expect(zoom).toHaveBeenCalledOnce();
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("owners", () => {
  test("the screen registered last wins, and the one before comes back when it leaves", () => {
    const app = vi.fn();
    const page = vi.fn();
    dispatcher.register({ id: "app.ask", run: app });
    const leave = dispatcher.register({ id: "app.ask", run: page });
    press("r");
    expect(page).toHaveBeenCalledOnce();
    expect(app).not.toHaveBeenCalled();
    leave();
    press("r");
    expect(app).toHaveBeenCalledOnce();
  });

  test("a key with no owner on screen does nothing", () => {
    const leave = dispatcher.register({ id: "app.ask", run: () => {} });
    expect(dispatcher.active.has("app.ask")).toBe(true);
    leave();
    expect(dispatcher.active.has("app.ask")).toBe(false);
    expect(press("r").result).toBeNull();
  });

  test("a screen's own keys cannot be registered here (the editor, the player and the tree read them)", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    dispatcher.register({ id: "doc.outline", run: () => {} });
    dispatcher.register({ id: "no.such", run: () => {} });
    expect(dispatcher.active.size).toBe(0);
    warn.mockRestore();
  });

  test("a handled key stops other window listeners added after it", () => {
    const other = vi.fn();
    window.addEventListener("keydown", other);
    dispatcher.register({ id: "app.ask", run: () => {} });
    press("r");
    expect(other).not.toHaveBeenCalled();
    press("x");
    expect(other).toHaveBeenCalledOnce();
    window.removeEventListener("keydown", other);
  });
});
