import { describe, expect, it } from "bun:test";
import {
  applyAction,
  createSelection,
  selectedItem,
  visibleItems,
} from "../../src/entrypoints/ui/selection-state.js";
import { parseKeypress } from "../../src/entrypoints/ui/terminal-keys.js";

const items = [
  { id: "chrome", label: "Google Chrome" },
  { id: "brave", label: "Brave" },
  { id: "firefox", label: "Mozilla Firefox" },
];

describe("selection state", () => {
  it("moves with arrows and j/k and clamps at the ends", () => {
    let state = createSelection(items, { id: "chrome", label: "Google Chrome" });

    state = applyAction(state, { type: "move", delta: 1 });
    expect(selectedItem(state)?.id).toBe("brave");

    state = applyAction(state, { type: "move", delta: 5 });
    expect(selectedItem(state)?.id).toBe("firefox");

    state = applyAction(state, { type: "move", delta: -9 });
    expect(selectedItem(state)?.id).toBe("chrome");
  });

  it("filters as characters are typed and keeps the cursor on a match", () => {
    let state = createSelection(items, items[0]!);
    for (const character of "fir") state = applyAction(state, { type: "character", value: character });

    expect(visibleItems(state).map((item) => item.id)).toEqual(["firefox"]);
    expect(selectedItem(state)?.id).toBe("firefox");
  });

  it("shows everything again after backspace", () => {
    let state = createSelection(items, items[0]!);
    state = applyAction(state, { type: "character", value: "q" });
    expect(visibleItems(state)).toHaveLength(0);

    state = applyAction(state, { type: "backspace" });
    expect(visibleItems(state)).toHaveLength(3);
  });

  it("loses the cursor target when the filter matches nothing", () => {
    let state = createSelection(items, items[0]!);
    state = applyAction(state, { type: "character", value: "q" });
    expect(selectedItem(state)).toBeNull();
  });

  it("prefers the provided initial item even when it is not first", () => {
    const state = createSelection(items, items[2]!);
    expect(selectedItem(state)?.id).toBe("firefox");
  });
});

describe("keypress parsing", () => {
  it("maps arrows, vi keys, enter, backspace and escape", () => {
    expect(parseKeypress("\u001b[A").kind).toBe("move");
    expect(parseKeypress("\u001b[A")).toEqual({ kind: "move", delta: -1 });
    expect(parseKeypress("\u001b[B")).toEqual({ kind: "move", delta: 1 });
    expect(parseKeypress("k")).toEqual({ kind: "move", delta: -1 });
    expect(parseKeypress("j")).toEqual({ kind: "move", delta: 1 });
    expect(parseKeypress("\r").kind).toBe("enter");
    expect(parseKeypress("\u007f").kind).toBe("backspace");
    expect(parseKeypress("\u001b").kind).toBe("escape");
  });

  it("parses an SGR mouse press with its row", () => {
    expect(parseKeypress("\u001b[<0;12;7M")).toEqual({ kind: "mouse", row: 7, column: 12, pressed: true });
  });
});
