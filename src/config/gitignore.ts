import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { ENV_CONFIG_FILE } from "./files.js";

const HEIZEN_ENTRIES = [
  ENV_CONFIG_FILE,
  "infra/node_modules",
  "infra/bin",
  "infra/Pulumi.*.yaml",
];
const SECTION_HEADER = "# Heizen";

export function ensureGitignore(cwd = process.cwd()): void {
  const path = resolve(cwd, ".gitignore");
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = new Set(existing.split("\n").map((l) => l.trim()));
  const missing = HEIZEN_ENTRIES.filter((e) => !lines.has(e));
  if (missing.length === 0) return;

  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const additions = ["", SECTION_HEADER, ...missing, ""].join("\n");
  writeFileSync(path, existing + separator + additions, "utf8");
}
