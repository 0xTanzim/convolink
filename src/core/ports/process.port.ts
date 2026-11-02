export interface ProcessProbe {
  isAlive(pid: number): boolean;
  /** Full command line, or null when the process is gone or unreadable. */
  cmdline(pid: number): string | null;
}
