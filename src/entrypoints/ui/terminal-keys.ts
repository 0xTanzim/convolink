export type ParsedKey =
  | { readonly kind: "move"; readonly delta: -1 | 1 }
  | { readonly kind: "character"; readonly value: string }
  | { readonly kind: "backspace" }
  | { readonly kind: "enter" }
  | { readonly kind: "escape" }
  | { readonly kind: "mouse"; readonly row: number; readonly column: number; readonly pressed: boolean }
  | { readonly kind: "unknown" };

const ARROW_UP = "\u001b[A";
const ARROW_DOWN = "\u001b[B";
const SGR_MOUSE = /^\u001b\[<(\d+);(\d+);(\d+)([Mm])$/;

/** Decodes one raw-mode chunk. Kept pure so selection logic is testable headlessly. */
export function parseKeypress(chunk: string): ParsedKey {
  const mouse = SGR_MOUSE.exec(chunk);
  if (mouse) {
    return {
      kind: "mouse",
      row: Number(mouse[3]),
      column: Number(mouse[2]),
      pressed: mouse[4] === "M",
    };
  }
  if (chunk === ARROW_UP || chunk === "\u001bOA") return { kind: "move", delta: -1 };
  if (chunk === ARROW_DOWN || chunk === "\u001bOB") return { kind: "move", delta: 1 };
  if (chunk === "k") return { kind: "move", delta: -1 };
  if (chunk === "j") return { kind: "move", delta: 1 };
  if (chunk === "\r" || chunk === "\n") return { kind: "enter" };
  if (chunk === "\u007f" || chunk === "\b") return { kind: "backspace" };
  if (chunk === "\u001b") return { kind: "escape" };
  if (chunk.length === 1 && chunk >= " ") return { kind: "character", value: chunk };
  return { kind: "unknown" };
}

/** SGR mouse reporting. Enabled only when the terminal answers a DA1 probe. */
export const MOUSE_ENABLE = "\u001b[?1000h\u001b[?1006h";
export const MOUSE_DISABLE = "\u001b[?1006l\u001b[?1000l";
export const CURSOR_SHOW = "\u001b[?25h";
export const CURSOR_HIDE = "\u001b[?25l";
export const CLEAR_LINE = "\r\u001b[2K";
