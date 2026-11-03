import { describe, expect, it } from "bun:test";
import { matchesManagedRecord, type ManagedTabRecord } from "../../src/adapters/browsers/tab-registry.js";

const record: ManagedTabRecord = {
  targetId: "111",
  platform: "chatgpt",
  url: "https://chatgpt.com/",
  threadId: "thread-abc",
  createdAt: "2026-11-03T00:00:00.000Z",
};

describe("matchesManagedRecord", () => {
  it("matches the recorded tab id", () => {
    expect(matchesManagedRecord(record, { targetId: "111", url: "https://chatgpt.com/", threadId: null })).toBe(true);
  });

  it("matches the conversation it was opened for", () => {
    expect(
      matchesManagedRecord(record, { targetId: "999", url: "https://chatgpt.com/c/thread-abc", threadId: "thread-abc" }),
    ).toBe(true);
  });

  it("does not claim a hand-opened tab that shares the platform root URL", () => {
    expect(matchesManagedRecord(record, { targetId: "999", url: "https://chatgpt.com/", threadId: null })).toBe(false);
  });

  it("ignores the default placeholder thread id on root URLs", () => {
    const rootRecord: ManagedTabRecord = { ...record, url: "https://chatgpt.com/", threadId: "default" };
    expect(matchesManagedRecord(rootRecord, { targetId: "999", url: "https://chatgpt.com/", threadId: "default" })).toBe(
      false,
    );
  });

  it("does not match an unrelated conversation", () => {
    expect(
      matchesManagedRecord(record, { targetId: "999", url: "https://chatgpt.com/c/other", threadId: "thread-other" }),
    ).toBe(false);
  });
});
