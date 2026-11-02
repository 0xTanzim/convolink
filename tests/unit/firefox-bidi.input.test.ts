import { describe, expect, it } from "bun:test";
import {
  dispatchBidiHumanClick,
  dispatchBidiKeyPress,
  dispatchBidiPaste,
} from "../../src/adapters/browsers/firefox-bidi.input.js";

describe("Gecko WebDriver BiDi Native Input Engine (firefox-bidi.input)", () => {
  it("builds multi-point pointer action sequence along Bezier path followed by pointerDown and pointerUp", async () => {
    const performedActions: Array<Record<string, unknown>> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      if (method === "input.performActions") {
        performedActions.push(params);
      }
      return {};
    };

    const targetCoords = { x: 400, y: 300 };
    await dispatchBidiHumanClick(mockSend, "context-1", targetCoords, { x: 50, y: 50 }, { steps: 5, dwellMs: 10 });

    expect(performedActions.length).toBe(1);
    const payload = performedActions[0]!;
    expect(payload.context).toBe("context-1");

    const actions = (payload.actions as Array<any>)[0];
    expect(actions.type).toBe("pointer");
    expect(actions.parameters.pointerType).toBe("mouse");

    const subActions = actions.actions;
    const moves = subActions.filter((a: any) => a.type === "pointerMove");
    const pointerDown = subActions.find((a: any) => a.type === "pointerDown");
    const pointerUp = subActions.find((a: any) => a.type === "pointerUp");

    expect(moves.length).toBeGreaterThanOrEqual(5);
    expect(pointerDown).toBeDefined();
    expect(pointerDown.button).toBe(0);
    expect(pointerUp).toBeDefined();
    expect(pointerUp.button).toBe(0);

    const lastMove = moves[moves.length - 1];
    expect(lastMove.x).toBe(400);
    expect(lastMove.y).toBe(300);
  });

  it("dispatches native key actions for Enter", async () => {
    const performedActions: Array<Record<string, unknown>> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      if (method === "input.performActions") performedActions.push(params);
      return {};
    };

    await dispatchBidiKeyPress(mockSend, "context-1", "Enter");

    expect(performedActions.length).toBe(1);
    const actions = (performedActions[0]!.actions as Array<any>)[0];
    expect(actions.type).toBe("key");

    const keyDown = actions.actions.find((a: any) => a.type === "keyDown");
    const keyUp = actions.actions.find((a: any) => a.type === "keyUp");

    expect(keyDown).toBeDefined();
    expect(keyDown.value).toBe("\uE007"); // W3C WebDriver Enter key
    expect(keyUp).toBeDefined();
    expect(keyUp.value).toBe("\uE007");
  });

  it("dispatches paste simulation with modifier key down/up and deliberation pause", async () => {
    const performedActions: Array<Record<string, unknown>> = [];
    const mockSend = async (method: string, params: Record<string, unknown>) => {
      if (method === "input.performActions") performedActions.push(params);
      return {};
    };

    let evaluatedExpr = "";
    const mockEval = async (expr: string) => {
      evaluatedExpr = expr;
      return true;
    };

    const start = Date.now();
    await dispatchBidiPaste(mockSend, "context-1", "Test BiDi Paste", mockEval, { deliberationMs: 20 });
    const elapsed = Date.now() - start;

    expect(elapsed).toBeGreaterThanOrEqual(18);
    expect(performedActions.length).toBeGreaterThanOrEqual(1);

    expect(evaluatedExpr).toContain("insertText");
    expect(evaluatedExpr).toContain("Test BiDi Paste");
  });
});
