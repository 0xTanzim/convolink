/**
 * Evaluates an in-page expression over CDP with execution-context retry handling.
 */
export async function evaluateCdpExpression<T>(
  sendFn: (method: string, params: Record<string, unknown>) => Promise<any>,
  expression: string,
  timeoutMs = 5000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await sendFn("Runtime.evaluate", {
        expression,
        returnByValue: true,
        awaitPromise: true,
      });
      if (res?.exceptionDetails) {
        const desc =
          res.exceptionDetails.exception?.description ||
          res.exceptionDetails.text ||
          JSON.stringify(res.exceptionDetails);
        throw new Error(`In-page evaluation error: ${desc}`);
      }
      return res?.result?.value as T;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Cannot find default execution context") && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 200));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Evaluation timed out waiting for execution context");
}
