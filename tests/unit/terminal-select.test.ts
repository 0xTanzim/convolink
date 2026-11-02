import { describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import {
  SelectUnavailableError,
  probeMouse,
  selectFromList,
  type KeySource,
  type RenderTarget,
} from "../../src/entrypoints/ui/terminal-select.js";

class FakeInput extends EventEmitter implements KeySource {
  public readonly isTTY = true;
  public rawModes: boolean[] = [];
  public paused = false;
  public setRawMode(mode: boolean) { this.rawModes.push(mode); }
  public pause() { this.paused = true; }
  public resume() { this.paused = false; }
}

class FakeOutput implements RenderTarget {
  public readonly isTTY = true;
  public buffer = "";
  public write(text: string) { this.buffer += text; return true; }
}

const items = [
  { id: "chrome", label: "Google Chrome" },
  { id: "brave", label: "Brave" },
  { id: "firefox", label: "Mozilla Firefox" },
];

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

describe("terminal selector", () => {
  it("selects with arrows and enter", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = selectFromList("Pick", items, { input, output, probeMs: 0 });

    await tick();
    input.emit("data", "\u001b[B");
    input.emit("data", "\u001b[B");
    input.emit("data", "\r");

    expect((await pending)?.id).toBe("firefox");
    expect(input.rawModes).toEqual([true, false]);
    expect(output.buffer).toContain("\u001b[?25h");
  });

  it("cancels with escape and still restores the terminal", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = selectFromList("Pick", items, { input, output, probeMs: 0 });

    await tick();
    input.emit("data", "\u001b");

    expect(await pending).toBeNull();
    expect(input.rawModes).toEqual([true, false]);
    expect(input.paused).toBe(true);
  });

  it("filters by typed characters", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = selectFromList("Pick", items, { input, output, probeMs: 0 });

    await tick();
    input.emit("data", "b");
    input.emit("data", "r");
    input.emit("data", "\r");

    expect((await pending)?.id).toBe("brave");
  });

  it("refuses to run without a TTY", async () => {
    const output = new FakeOutput();
    const input = Object.assign(new FakeInput(), { isTTY: false });
    expect(selectFromList("Pick", items, { input, output, probeMs: 0 })).rejects.toBeInstanceOf(SelectUnavailableError);
  });

  it("keeps mouse mode off when the terminal does not answer the probe", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    expect(await probeMouse(input, output, 10)).toBe(false);
    expect(output.buffer).not.toContain("\u001b[?1000h");
  });

  it("enables mouse mode when the terminal answers", async () => {
    const input = new FakeInput();
    const output = new FakeOutput();
    const pending = probeMouse(input, output, 50);
    input.emit("data", "\u001b[?1;2c");
    expect(await pending).toBe(true);
  });
});
