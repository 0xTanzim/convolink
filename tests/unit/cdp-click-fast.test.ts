import { describe, expect, it } from "bun:test";
import { executeCdpClick } from "../../src/adapters/browsers/raw-cdp.actions.js";

describe("executeCdpClick", () => {
  it("uses two trusted mouse events instead of a Bezier path by default", async () => {
    const calls: string[] = [];
    const evaluate = async <T>(): Promise<T> => ({ left: 10, top: 10, width: 40, height: 20 }) as T;
    const send = async (method: string): Promise<unknown> => {
      calls.push(method);
      return {};
    };

    await executeCdpClick(evaluate, send, "target", "#composer");

    expect(calls).toEqual(["Input.dispatchMouseEvent", "Input.dispatchMouseEvent"]);
  });
});
