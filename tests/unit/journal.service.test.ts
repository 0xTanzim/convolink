import { describe, expect, it } from "bun:test";
import { StateJournalService } from "../../src/core/services/journal.service.js";

describe("StateJournalService Checkpointing & Rollback", () => {
  it("records a session checkpoint and retrieves the latest", () => {
    const journal = new StateJournalService();

    const chk1 = journal.record({
      targetId: "t1",
      platformId: "chatgpt",
      url: "https://chatgpt.com/c/123",
      threadId: "123",
      action: "ask",
    });

    expect(chk1.id).toBeDefined();
    expect(chk1.timestamp).toBeDefined();
    expect(chk1.targetId).toBe("t1");

    const chk2 = journal.record({
      targetId: "t1",
      platformId: "chatgpt",
      url: "https://chatgpt.com/c/456",
      threadId: "456",
      action: "new_chat",
    });

    const latest = journal.getLatest("t1");
    expect(latest?.id).toBe(chk2.id);
    expect(latest?.url).toBe("https://chatgpt.com/c/456");

    const previous = journal.getPrevious("t1");
    expect(previous?.id).toBe(chk1.id);
    expect(previous?.url).toBe("https://chatgpt.com/c/123");
  });

  it("filters checkpoints by targetId and limits history", () => {
    const journal = new StateJournalService(5);

    journal.record({ targetId: "t1", url: "https://chatgpt.com/c/1", action: "ask" });
    journal.record({ targetId: "t2", url: "https://chat.deepseek.com/s/2", action: "ask" });
    journal.record({ targetId: "t1", url: "https://chatgpt.com/c/3", action: "navigate" });

    const t1History = journal.list("t1");
    expect(t1History.length).toBe(2);
    expect(t1History[0]?.url).toBe("https://chatgpt.com/c/3"); // newest first
    expect(t1History[1]?.url).toBe("https://chatgpt.com/c/1");

    const allHistory = journal.list();
    expect(allHistory.length).toBe(3);
  });

  it("clears checkpoints safely", () => {
    const journal = new StateJournalService();
    journal.record({ targetId: "t1", url: "https://gemini.google.com/app/1", action: "ask" });
    expect(journal.list().length).toBe(1);

    journal.clear();
    expect(journal.list().length).toBe(0);
    expect(journal.getLatest()).toBeNull();
  });
});
