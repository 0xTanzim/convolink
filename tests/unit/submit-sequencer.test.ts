import { describe, expect, it } from "bun:test";
import { SubmitSequencer } from "../../src/core/services/submit-sequencer.js";

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SubmitSequencer", () => {
  it("starts the next task only after the previous one reports submission", async () => {
    const sequencer = new SubmitSequencer();
    const events: string[] = [];

    const slow = sequencer.run(async (onSubmitted) => {
      events.push("slow:start");
      await delay(30);
      onSubmitted();
      events.push("slow:submitted");
      await delay(40);
      events.push("slow:done");
      return "slow";
    });

    await delay(1);
    const fast = sequencer.run(async (onSubmitted) => {
      events.push("fast:start");
      onSubmitted();
      events.push("fast:done");
      return "fast";
    });

    expect(await Promise.all([slow, fast])).toEqual(["slow", "fast"]);
    expect(events.indexOf("fast:start")).toBeGreaterThan(events.indexOf("slow:submitted"));
    expect(events.indexOf("fast:start")).toBeLessThan(events.indexOf("slow:done"));
  });

  it("releases the queue when a task fails before submitting", async () => {
    const sequencer = new SubmitSequencer();

    const failing = sequencer.run(async () => {
      throw new Error("boom");
    });
    const next = sequencer.run(async (onSubmitted) => {
      onSubmitted();
      return "next";
    });

    await expect(failing).rejects.toThrow("boom");
    expect(await next).toBe("next");
  });

  it("serializes three submissions in order", async () => {
    const sequencer = new SubmitSequencer();
    const order: string[] = [];

    const tasks = ["a", "b", "c"].map((name, index) =>
      sequencer.run(async (onSubmitted) => {
        order.push(`${name}:start`);
        await delay(10 * (3 - index));
        onSubmitted();
        order.push(`${name}:submitted`);
        return name;
      }),
    );

    await Promise.all(tasks);
    expect(order).toEqual(["a:start", "a:submitted", "b:start", "b:submitted", "c:start", "c:submitted"]);
  });
});
