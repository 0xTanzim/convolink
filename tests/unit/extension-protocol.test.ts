import { describe, expect, it } from "bun:test";
import {
  formatCompoundTargetId,
  parseCompoundTargetId,
  type ClientHandshake,
  type BrowserTarget,
} from "../../src/core/ports/extension-protocol.js";

describe("Extension Protocol & Identity Contracts", () => {
  it("formats and parses compound target IDs deterministically", () => {
    const clientId = "client-uuid-123";
    const tabId = 456;
    const compound = formatCompoundTargetId(clientId, tabId);
    expect(compound).toBe("client-uuid-123::456");

    const parsed = parseCompoundTargetId(compound);
    expect(parsed).toEqual({ clientId: "client-uuid-123", tabId: 456 });
  });

  it("returns null when parsing an invalid compound target ID", () => {
    expect(parseCompoundTargetId("invalid-format")).toBeNull();
    expect(parseCompoundTargetId("")).toBeNull();
    expect(parseCompoundTargetId("client::not-a-number")).toBeNull();
  });

  it("validates ClientHandshake data structure", () => {
    const handshake: ClientHandshake = {
      protocolVersion: 2,
      clientId: "client-abc",
      installationProfileId: "prof-xyz",
      connectionId: "conn-123",
      browserFamily: "chrome",
      profileLabel: "Personal",
      extensionVersion: "1.0.0",
      token: "secret-token",
    };
    expect(handshake.protocolVersion).toBe(2);
    expect(handshake.browserFamily).toBe("chrome");
    expect(handshake.clientId).toBe("client-abc");
  });

  it("validates BrowserTarget structure with connection scoping", () => {
    const target: BrowserTarget = {
      targetId: "ext-target-456",
      clientId: "client-abc",
      connectionId: "conn-123",
      tabId: 456,
      url: "https://chatgpt.com/",
      title: "ChatGPT",
      browserFamily: "chrome",
      profileLabel: "Personal",
    };
    expect(target.targetId).toBe("ext-target-456");
    expect(target.connectionId).toBe("conn-123");
  });
});
