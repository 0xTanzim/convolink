import { describe, expect, it } from "bun:test";
import {
  dispatchCdpHumanClick,
  dispatchCdpKeyPress,
  dispatchCdpPaste,
} from "../../src/adapters/browsers/raw-cdp.input.js";

describe("Chromium CDP Native Input Engine (raw-cdp.input)", () => {
  it("dispatches mouseMoved along Bezier trajectory followed by mousePressed and mouseReleased", async () => {
    const sentEvents: Array<{ method: string; params: Record<string, unknown> }> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      sentEvents.push({ method, params });
      return {};
    };

    const targetCoords = { x: 300, y: 200 };
    await dispatchCdpHumanClick(mockSend, "tab-1", targetCoords, { x: 50, y: 50 }, { steps: 5, dwellMs: 10 });

    const moveEvents = sentEvents.filter((e) => e.method === "Input.dispatchMouseEvent" && e.params.type === "mouseMoved");
    const pressEvent = sentEvents.find((e) => e.method === "Input.dispatchMouseEvent" && e.params.type === "mousePressed");
    const releaseEvent = sentEvents.find((e) => e.method === "Input.dispatchMouseEvent" && e.params.type === "mouseReleased");

    expect(moveEvents.length).toBeGreaterThanOrEqual(5);
    expect(pressEvent).toBeDefined();
    expect(releaseEvent).toBeDefined();

    expect(pressEvent!.params.button).toBe("left");
    expect(pressEvent!.params.x).toBe(300);
    expect(pressEvent!.params.y).toBe(200);

    expect(releaseEvent!.params.button).toBe("left");
  });

  it("dispatches native key press for Enter", async () => {
    const sentEvents: Array<{ method: string; params: Record<string, unknown> }> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      sentEvents.push({ method, params });
      return {};
    };

    await dispatchCdpKeyPress(mockSend, "tab-1", "Enter");

    const keyDown = sentEvents.find((e) => e.method === "Input.dispatchKeyEvent" && e.params.type === "rawKeyDown");
    const keyUp = sentEvents.find((e) => e.method === "Input.dispatchKeyEvent" && e.params.type === "keyUp");

    expect(keyDown).toBeDefined();
    expect(keyDown!.params.key).toBe("Enter");
    expect(keyDown!.params.code).toBe("Enter");
    expect(keyDown!.params.windowsVirtualKeyCode).toBe(13);

    expect(keyUp).toBeDefined();
    expect(keyUp!.params.key).toBe("Enter");
  });

  it("dispatches paste simulation with modifier key events and deliberation pause", async () => {
    const sentEvents: Array<{ method: string; params: Record<string, unknown> }> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      sentEvents.push({ method, params });
      return {};
    };

    let evaluatedExpr = "";
    const mockEval = async (expr: string) => {
      evaluatedExpr = expr;
      return true;
    };

    const start = Date.now();
    await dispatchCdpPaste(mockSend, "tab-1", "Hello from ConvoLink test", mockEval, { deliberationMs: 25 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(20);

    const controlDown = sentEvents.find((e) => e.params.key === "Control" && e.params.type === "rawKeyDown");
    const vDown = sentEvents.find((e) => e.params.key === "v" && e.params.type === "rawKeyDown");
    const vUp = sentEvents.find((e) => e.params.key === "v" && e.params.type === "keyUp");
    const controlUp = sentEvents.find((e) => e.params.key === "Control" && e.params.type === "keyUp");

    expect(controlDown).toBeDefined();
    expect(vDown).toBeDefined();
    expect(vUp).toBeDefined();
    expect(controlUp).toBeDefined();

    expect(evaluatedExpr).toContain("insertText");
  });

  it("targets selector directly and handles textarea prototype setter", async () => {
    const sentEvents: Array<{ method: string; params: Record<string, unknown> }> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      sentEvents.push({ method, params });
      return {};
    };

    let evaluatedExpr = "";
    const mockEval = async (expr: string) => {
      evaluatedExpr = expr;
      return { ok: true, length: 15 };
    };

    const res = await dispatchCdpPaste(
      mockSend,
      "tab-1",
      "test textarea prompt",
      mockEval,
      "textarea#chat-input",
      { deliberationMs: 5 },
    );

    expect(res.ok).toBe(true);
    expect(res.length).toBe(15);
    expect(evaluatedExpr).toContain("textarea#chat-input");
    expect(evaluatedExpr).toContain("HTMLTextAreaElement");
  });
});
