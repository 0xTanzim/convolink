import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { handleExt } from "../../src/entrypoints/cli.ext.js";
import { BridgeTokenService } from "../../src/core/services/bridge-token.service.js";

describe("CLI Extension Operations (convo ext)", () => {
  let tempDir: string;
  let tokenFile: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "convolink-cli-ext-"));
    tokenFile = path.join(tempDir, "bridge-token.json");
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  it("handles 'convo ext pair' by displaying the pairing token", async () => {
    const service = new BridgeTokenService(tokenFile);
    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      const code = await handleExt(["pair"], service);
      expect(code).toBe(0);
      expect(logs.some((l) => l.includes("ConvoLink Extension Pairing Token"))).toBe(true);
      expect(logs.some((l) => l.includes(service.getToken()))).toBe(true);
    } finally {
      console.log = origLog;
    }
  });

  it("handles 'convo ext pair --rotate' by rotating the pairing token", async () => {
    const service = new BridgeTokenService(tokenFile);
    const oldToken = service.getToken();

    const logs: string[] = [];
    const origLog = console.log;
    console.log = (...args: any[]) => logs.push(args.join(" "));

    try {
      const code = await handleExt(["pair", "--rotate"], service);
      expect(code).toBe(0);
      expect(logs.some((l) => l.includes("Token rotated successfully"))).toBe(true);
      expect(service.getToken()).not.toBe(oldToken);
    } finally {
      console.log = origLog;
    }
  });

  it("handles unknown ext subcommand gracefully", async () => {
    const errors: string[] = [];
    const origErr = console.error;
    console.error = (...args: any[]) => errors.push(args.join(" "));

    try {
      const code = await handleExt(["unknown-cmd"]);
      expect(code).toBe(1);
      expect(errors.some((e) => e.includes("Unknown ext command"))).toBe(true);
    } finally {
      console.error = origErr;
    }
  });
});
