import fs from "node:fs";
import os from "node:os";

export type OsFamily = "linux" | "darwin" | "win32" | "unknown";
export type CpuArch = "x86_64" | "arm64" | "unsupported";
export type LinuxDistro = "fedora" | "ubuntu" | "debian" | "arch" | "alpine" | "opensuse" | "nixos" | "unknown";
export type LibcVariant = "glibc" | "musl";

export interface PlatformSnapshot {
  readonly os: OsFamily;
  readonly arch: CpuArch;
  readonly distro?: LinuxDistro;
  readonly libc?: LibcVariant;
  readonly isWsl: boolean;
  readonly wslGatewayIp?: string | null;
  readonly isHeadless: boolean;
}

export class PlatformEnv {
  public static getOs(): OsFamily {
    const p = os.platform();
    if (p === "linux" || p === "darwin" || p === "win32") return p;
    return "unknown";
  }

  public static getArchitecture(): CpuArch {
    const m = os.arch();
    if (m === "x64") return "x86_64";
    if (m === "arm64") return "arm64";
    return "unsupported";
  }

  public static parseDistroFromRelease(content: string): LinuxDistro {
    const idMatch = content.match(/^ID=(?:"?)([^"\n]+)(?:"?)/m);
    if (!idMatch) return "unknown";
    const id = idMatch[1]!.toLowerCase().trim();
    if (id.includes("fedora") || id.includes("rhel") || id.includes("centos") || id.includes("rocky")) return "fedora";
    if (id.includes("ubuntu") || id.includes("pop")) return "ubuntu";
    if (id.includes("debian")) return "debian";
    if (id.includes("arch") || id.includes("manjaro")) return "arch";
    if (id.includes("alpine")) return "alpine";
    if (id.includes("suse")) return "opensuse";
    if (id.includes("nixos")) return "nixos";
    return "unknown";
  }

  public static parseWslFromProcVersion(content: string): boolean {
    return /microsoft|wsl/i.test(content);
  }

  public static parseGatewayFromRoute(content: string): string | null {
    const match = content.match(/^default\s+via\s+([0-9.]+)/m);
    return match && match[1] ? match[1] : null;
  }

  public static parseLibc(options: { isAlpine?: boolean; lddOutput?: string }): LibcVariant {
    if (options.isAlpine) return "musl";
    if (options.lddOutput && /musl/i.test(options.lddOutput)) return "musl";
    return "glibc";
  }

  public static evaluateHeadless(osFamily: OsFamily, display?: string, wayland?: string): boolean {
    if (osFamily !== "linux") return false;
    return (!display || display.trim().length === 0) && (!wayland || wayland.trim().length === 0);
  }

  public static isWsl(): boolean {
    return this.detect().isWsl;
  }

  public static getWslGatewayIp(): string | null {
    return this.detect().wslGatewayIp ?? null;
  }

  public static isHeadless(): boolean {
    return this.evaluateHeadless(this.getOs(), process.env.DISPLAY, process.env.WAYLAND_DISPLAY);
  }

  public static detect(): PlatformSnapshot {
    const osFamily = this.getOs();
    const arch = this.getArchitecture();

    let distro: LinuxDistro | undefined;
    let libc: LibcVariant | undefined;
    let isWsl = false;
    let wslGatewayIp: string | null = null;

    if (osFamily === "linux") {
      try {
        if (fs.existsSync("/etc/os-release")) {
          distro = this.parseDistroFromRelease(fs.readFileSync("/etc/os-release", "utf8"));
        }
        if (fs.existsSync("/proc/version")) {
          isWsl = this.parseWslFromProcVersion(fs.readFileSync("/proc/version", "utf8"));
        }
        if (isWsl) {
          try {
            const { execSync } = require("node:child_process");
            const route = execSync("ip route show default 2>/dev/null", { encoding: "utf8" });
            wslGatewayIp = this.parseGatewayFromRoute(route);
          } catch {}
        }
        const isAlpine = fs.existsSync("/etc/alpine-release");
        libc = this.parseLibc({ isAlpine });
      } catch {}
    }

    const isHeadless = this.evaluateHeadless(osFamily, process.env.DISPLAY, process.env.WAYLAND_DISPLAY);

    return { os: osFamily, arch, distro, libc, isWsl, wslGatewayIp, isHeadless };
  }
}
