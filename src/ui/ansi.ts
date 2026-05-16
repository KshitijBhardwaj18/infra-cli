const ANSI_PATTERN = /\x1b\[[0-9;]*m/g;

export function stripAnsi(s: string): string {
  return s.replace(ANSI_PATTERN, "");
}

export function padRight(s: string, width: number): string {
  return s + " ".repeat(Math.max(0, width - stripAnsi(s).length));
}
