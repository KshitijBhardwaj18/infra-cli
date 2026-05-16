import { ExecaError } from "execa";

export const DEFAULT_PASSPHRASE = "heizen-managed-passphrase";

export function formatExecError(err: unknown): string {
  if (err instanceof ExecaError) {
    return (err.stderr || err.stdout || err.message || "").toString();
  }
  return err instanceof Error ? err.message : String(err);
}
