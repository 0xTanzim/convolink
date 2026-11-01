import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { HostEnv } from "../env/host-env.js";

export interface StoredBridgeToken {
  readonly token: string;
  readonly createdAt: string;
}

export class BridgeTokenService {
  private readonly filePath: string;
  private cachedToken: string | null = null;

  public constructor(filePath?: string) {
    this.filePath = filePath || HostEnv.getBridgeTokenPath();
  }

  public getToken(): string {
    if (this.cachedToken) return this.cachedToken;

    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, "utf-8");
        const parsed = JSON.parse(raw) as Partial<StoredBridgeToken>;
        if (parsed.token && typeof parsed.token === "string" && parsed.token.length >= 16) {
          this.cachedToken = parsed.token;
          return this.cachedToken;
        }
      } catch {}
    }

    return this.generateAndPersistToken();
  }

  public validateToken(token?: string): boolean {
    if (!token || typeof token !== "string") return false;
    const current = this.getToken();
    if (token.length !== current.length) return false;
    try {
      return crypto.timingSafeEqual(Buffer.from(token, "utf-8"), Buffer.from(current, "utf-8"));
    } catch {
      return false;
    }
  }

  public rotateToken(): string {
    return this.generateAndPersistToken();
  }

  private generateAndPersistToken(): string {
    const newToken = crypto.randomBytes(24).toString("hex");
    const payload: StoredBridgeToken = {
      token: newToken,
      createdAt: new Date().toISOString(),
    };

    const dir = path.dirname(this.filePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    fs.writeFileSync(this.filePath, JSON.stringify(payload, null, 2), {
      encoding: "utf-8",
      mode: 0o600,
    });

    this.cachedToken = newToken;
    return newToken;
  }
}
