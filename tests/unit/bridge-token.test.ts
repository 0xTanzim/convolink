import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BridgeTokenService } from "../../src/core/services/bridge-token.service.js";

describe("BridgeTokenService", () => {
  let tempDir: string;
  let tokenFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convolink-token-test-"));
    tokenFile = path.join(tempDir, "bridge-token.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("generates a new token if token file does not exist", () => {
    const service = new BridgeTokenService(tokenFile);
    const token = service.getToken();

    expect(token).toBeDefined();
    expect(token.length).toBeGreaterThanOrEqual(32);
    expect(fs.existsSync(tokenFile)).toBe(true);

    const data = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
    expect(data.token).toBe(token);
    expect(data.createdAt).toBeDefined();
  });

  it("loads the existing token without overwriting it", () => {
    fs.writeFileSync(tokenFile, JSON.stringify({ token: "pre-existing-secret-1234567890abcdef", createdAt: new Date().toISOString() }));
    const service = new BridgeTokenService(tokenFile);
    const token = service.getToken();

    expect(token).toBe("pre-existing-secret-1234567890abcdef");
  });

  it("validates token correctly", () => {
    const service = new BridgeTokenService(tokenFile);
    const activeToken = service.getToken();

    expect(service.validateToken(activeToken)).toBe(true);
    expect(service.validateToken("wrong-token")).toBe(false);
    expect(service.validateToken("")).toBe(false);
    expect(service.validateToken(undefined)).toBe(false);
  });

  it("rotates token and updates file", () => {
    const service = new BridgeTokenService(tokenFile);
    const initialToken = service.getToken();
    const rotated = service.rotateToken();

    expect(rotated).not.toBe(initialToken);
    expect(service.validateToken(rotated)).toBe(true);
    expect(service.validateToken(initialToken)).toBe(false);

    const data = JSON.parse(fs.readFileSync(tokenFile, "utf-8"));
    expect(data.token).toBe(rotated);
  });
});
