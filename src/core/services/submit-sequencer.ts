/**
 * One BiDi session carries every tab's DOM commands. Filling and submitting
 * three composers at the same instant makes at least one platform miss its
 * input event, so the send control never enables. Submission is therefore
 * serialized; generation still overlaps, which is where the time actually goes.
 */
export class SubmitSequencer {
  private tail: Promise<void> = Promise.resolve();

  public async run<T>(task: (onSubmitted: () => void) => Promise<T>): Promise<T> {
    const turn = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });

    await turn;
    try {
      return await task(release);
    } finally {
      // A failed platform must not wedge the queue for the others.
      release();
    }
  }
}
