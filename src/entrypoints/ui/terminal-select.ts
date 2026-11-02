import {
  applyAction,
  createSelection,
  selectedItem,
  visibleItems,
} from "./selection-state.js";
import type { SelectionItem } from "./selection-state.js";
import {
  CLEAR_LINE,
  CURSOR_HIDE,
  CURSOR_SHOW,
  MOUSE_DISABLE,
  MOUSE_ENABLE,
  parseKeypress,
} from "./terminal-keys.js";

export class SelectUnavailableError extends Error {
  public readonly code = "selection-unavailable";
}

export interface KeySource {
  readonly isTTY?: boolean;
  setRawMode?(mode: boolean): void;
  on(event: "data", listener: (chunk: Buffer | string) => void): void;
  off?(event: "data", listener: (chunk: Buffer | string) => void): void;
  removeListener?(event: "data", listener: (chunk: Buffer | string) => void): void;
  pause?(): void;
  resume?(): void;
}

export interface RenderTarget {
  readonly isTTY?: boolean;
  readonly columns?: number;
  write(text: string): boolean;
}

export interface SelectOptions {
  readonly input?: KeySource;
  readonly output?: RenderTarget;
  readonly mouse?: boolean;
  readonly probeMs?: number;
  readonly maxRows?: number;
}

const DEFAULT_ROWS = 10;

/**
 * Reads the terminal for one selection. Everything it changes (raw mode, cursor,
 * mouse reporting) is restored in `finally`, including when the caller throws.
 */
export async function selectFromList(
  title: string,
  items: readonly SelectionItem[],
  options: SelectOptions = {},
): Promise<SelectionItem | null> {
  const input = options.input ?? (process.stdin as unknown as KeySource);
  const output = options.output ?? (process.stdout as unknown as RenderTarget);
  if (!input.isTTY || !output.isTTY) throw new SelectUnavailableError("selection requires a TTY");

  input.setRawMode?.(true);
  input.resume?.();
  output.write(CURSOR_HIDE);

  const mouse = options.mouse !== false && (await probeMouse(input, output, options.probeMs ?? 80));
  if (mouse) output.write(MOUSE_ENABLE);

  let rendered = 0;
  const render = (lines: readonly string[]) => {
    if (rendered > 0) output.write(`\u001b[${rendered}A`);
    for (const line of lines) output.write(`${CLEAR_LINE}${line}\n`);
    rendered = lines.length;
  };

  const state = createSelection(items);
  const maxRows = Math.max(3, options.maxRows ?? DEFAULT_ROWS);

  return await new Promise<SelectionItem | null>((resolve) => {
    const draw = () => {
      const visible = visibleItems(state);
      const window = visible.slice(0, maxRows);
      const current = selectedItem(state);
      const lines = [
        `\u001b[1m${title}\u001b[0m`,
        ...window.map((item) => `${item.id === current?.id ? "\u001b[36m❯" : " "} ${item.label}\u001b[0m`),
        `\u001b[2mfilter: ${state.query || "—"}   ↑/↓ move · type to filter · enter select · esc cancel\u001b[0m`,
      ];
      render(lines);
    };

    const bodyStartRow = 2;
    const finish = (item: SelectionItem | null) => {
      input.off?.("data", onData);
      input.removeListener?.("data", onData);
      resolve(item);
    };

    const onData = (chunk: Buffer | string) => {
      const parsed = parseKeypress(String(chunk));
      if (parsed.kind === "enter") return finish(selectedItem(state));
      if (parsed.kind === "escape") return finish(null);
      if (parsed.kind === "character" && parsed.value === "\u0003") return finish(null);

      if (parsed.kind === "mouse" && parsed.pressed) {
        const visible = visibleItems(state);
        const index = parsed.row - bodyStartRow;
        const target = visible[index];
        if (target) return finish(target);
        return;
      }

      if (parsed.kind === "move") Object.assign(state, applyAction(state, { type: "move", delta: parsed.delta }));
      else if (parsed.kind === "character") Object.assign(state, applyAction(state, { type: "character", value: parsed.value }));
      else if (parsed.kind === "backspace") Object.assign(state, applyAction(state, { type: "backspace" }));
      else return;
      draw();
    };

    input.on("data", onData);
    draw();
  }).finally(() => {
    if (mouse) output.write(MOUSE_DISABLE);
    output.write(CURSOR_SHOW);
    input.setRawMode?.(false);
    input.pause?.();
  });
}

/**
 * SGR mouse reporting is answered only by terminals that understand it. A DA1
 * probe keeps escape sequences out of terminals that would render them raw.
 */
export async function probeMouse(
  input: KeySource,
  output: RenderTarget,
  timeoutMs: number,
): Promise<boolean> {
  if (timeoutMs <= 0) return false;
  return await new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (value: boolean) => {
      if (settled) return;
      settled = true;
      input.off?.("data", onData);
      input.removeListener?.("data", onData);
      clearTimeout(timer);
      resolve(value);
    };
    const onData = () => done(true);
    const timer = setTimeout(() => done(false), timeoutMs);
    input.on("data", onData);
    output.write("\u001b[c");
  });
}
