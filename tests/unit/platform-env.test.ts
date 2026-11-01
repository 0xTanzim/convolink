import { describe, expect, it } from "bun:test";
import { PlatformEnv } from "../../src/core/env/platform-env.js";

describe("PlatformEnv", () => {
  it("detects current operating system family", () => {
    const osFamily = PlatformEnv.getOs();
    expect(["linux", "darwin", "win32", "unknown"]).toContain(osFamily);
  });

  it("detects current CPU architecture", () => {
    const arch = PlatformEnv.getArchitecture();
    expect(["x86_64", "arm64", "unsupported"]).toContain(arch);
  });

  it("parses Linux distribution family from /etc/os-release mock content", () => {
    const fedoraRelease = `NAME="Fedora Linux"\nID=fedora\nID_LIKE=""\n`;
    expect(PlatformEnv.parseDistroFromRelease(fedoraRelease)).toBe("fedora");

    const ubuntuRelease = `NAME="Ubuntu"\nID=ubuntu\nID_LIKE=debian\n`;
    expect(PlatformEnv.parseDistroFromRelease(ubuntuRelease)).toBe("ubuntu");

    const archRelease = `NAME="Arch Linux"\nID=arch\n`;
    expect(PlatformEnv.parseDistroFromRelease(archRelease)).toBe("arch");

    const alpineRelease = `NAME="Alpine Linux"\nID=alpine\n`;
    expect(PlatformEnv.parseDistroFromRelease(alpineRelease)).toBe("alpine");

    const nixosRelease = `NAME="NixOS"\nID=nixos\n`;
    expect(PlatformEnv.parseDistroFromRelease(nixosRelease)).toBe("nixos");

    const unknownRelease = `NAME="Custom OS"\nID=custom\n`;
    expect(PlatformEnv.parseDistroFromRelease(unknownRelease)).toBe("unknown");
  });

  it("detects WSL from kernel version strings", () => {
    const wslVersion = "Linux version 5.15.153.1-microsoft-standard-WSL2 (root@buildhost)";
    expect(PlatformEnv.parseWslFromProcVersion(wslVersion)).toBe(true);

    const nativeVersion = "Linux version 6.11.4-200.fc40.x86_64 (mockbuild@fedora)";
    expect(PlatformEnv.parseWslFromProcVersion(nativeVersion)).toBe(false);
  });

  it("parses WSL default gateway IP from routing output", () => {
    const routeOutput = "default via 172.28.16.1 dev eth0 proto kernel\n172.28.16.0/20 dev eth0 proto kernel scope link src 172.28.27.13\n";
    expect(PlatformEnv.parseGatewayFromRoute(routeOutput)).toBe("172.28.16.1");

    const emptyOutput = "";
    expect(PlatformEnv.parseGatewayFromRoute(emptyOutput)).toBeNull();
  });

  it("identifies libc variants accurately", () => {
    expect(PlatformEnv.parseLibc({ isAlpine: true, lddOutput: "" })).toBe("musl");
    expect(PlatformEnv.parseLibc({ isAlpine: false, lddOutput: "ldd (GNU libc) 2.39" })).toBe("glibc");
    expect(PlatformEnv.parseLibc({ isAlpine: false, lddOutput: "musl libc (x86_64)" })).toBe("musl");
    expect(PlatformEnv.parseLibc({ isAlpine: false, lddOutput: "" })).toBe("glibc");
  });

  it("detects headless environments on Linux when display variables are unset", () => {
    expect(PlatformEnv.evaluateHeadless("linux", undefined, undefined)).toBe(true);
    expect(PlatformEnv.evaluateHeadless("linux", ":0", undefined)).toBe(false);
    expect(PlatformEnv.evaluateHeadless("linux", undefined, "wayland-0")).toBe(false);
    expect(PlatformEnv.evaluateHeadless("darwin", undefined, undefined)).toBe(false);
    expect(PlatformEnv.evaluateHeadless("win32", undefined, undefined)).toBe(false);
  });

  it("returns comprehensive snapshot from detect()", () => {
    const snapshot = PlatformEnv.detect();
    expect(snapshot.os).toBeDefined();
    expect(snapshot.arch).toBeDefined();
    expect(typeof snapshot.isWsl).toBe("boolean");
    expect(typeof snapshot.isHeadless).toBe("boolean");
  });
});
