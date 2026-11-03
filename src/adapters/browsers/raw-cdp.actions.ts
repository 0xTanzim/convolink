import { computeTargetCoordinates } from "../common/human-motor.js";
import { dispatchCdpHumanClick, dispatchCdpKeyPress } from "./raw-cdp.input.js";
import { getClickExpr } from "./raw-cdp.scripts.js";

export async function executeCdpClick(
  evaluate: <T>(expr: string) => Promise<T>,
  send: (method: string, params: Record<string, unknown>) => Promise<any>,
  targetId: string,
  selector: string,
): Promise<void> {
  try {
    const box = await evaluate<{ left: number; top: number; width: number; height: number } | null>(
      `(() => {
        const el = document.querySelector(${JSON.stringify(selector)});
        if (!el) return null;
        el.scrollIntoView({ block: 'center', inline: 'center' });
        const r = el.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      })()`,
    );
    if (box && box.width > 0 && box.height > 0) {
      // Human-motor simulation costs one CDP round trip per Bezier point, and a
      // background renderer answers each one slowly (measured ~3s x 35 points).
      // It is opt-in now: correctness never depended on the cursor path.
      if (process.env.CONVOLINK_HUMAN_MOTOR === "1") {
        const target = computeTargetCoordinates(box);
        await dispatchCdpHumanClick((m, p) => send(m, p), targetId, target);
        return;
      }
      const target = computeTargetCoordinates(box);
      await send("Input.dispatchMouseEvent", {
        type: "mousePressed", x: target.x, y: target.y, button: "left", clickCount: 1,
      });
      await send("Input.dispatchMouseEvent", {
        type: "mouseReleased", x: target.x, y: target.y, button: "left", clickCount: 1,
      });
      return;
    }
  } catch {}
  await evaluate(getClickExpr(selector));
}

export async function executeCdpKeyPress(
  evaluate: <T>(expr: string) => Promise<T>,
  send: (method: string, params: Record<string, unknown>) => Promise<any>,
  targetId: string,
  selector: string,
  key: string,
): Promise<void> {
  try {
    await dispatchCdpKeyPress((m, p) => send(m, p), targetId, key);
    return;
  } catch {}
  await evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)}) || document.activeElement || document.body;
    el.dispatchEvent(new KeyboardEvent('keydown', { key: ${JSON.stringify(key)}, bubbles: true }));
  })()`);
}
