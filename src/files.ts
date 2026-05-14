import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

import type { HeizenConfig, HeizenEnvConfig } from "./schema/types.js";

export const CONFIG_FILE = "heizen.yaml";
export const ENV_CONFIG_FILE = "heizen.env.yaml";
export const SECRETS_FILE = ".heizen.secrets";

const GITIGNORE_ENTRIES = [
  ENV_CONFIG_FILE,
  SECRETS_FILE,
  "infra/node_modules",
  "infra/bin",
  "infra/Pulumi.*.yaml",
];

export function configPath(cwd = process.cwd()): string {
  return resolve(cwd, CONFIG_FILE);
}

export function envConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, ENV_CONFIG_FILE);
}

export function secretsPath(cwd = process.cwd()): string {
  return resolve(cwd, SECRETS_FILE);
}

export function readConfig(cwd = process.cwd()): HeizenConfig | null {
  const p = configPath(cwd);
  if (!existsSync(p)) return null;
  return yaml.load(readFileSync(p, "utf8")) as HeizenConfig;
}

export function readEnvConfig(cwd = process.cwd()): HeizenEnvConfig | null {
  const p = envConfigPath(cwd);
  if (!existsSync(p)) return null;
  return yaml.load(readFileSync(p, "utf8")) as HeizenEnvConfig;
}

export function writeConfig(cfg: HeizenConfig, cwd = process.cwd()): void {
  writeFileSync(configPath(cwd), yaml.dump(cfg, { lineWidth: 120, noRefs: true }), "utf8");
}

export function writeEnvConfig(cfg: HeizenEnvConfig, cwd = process.cwd()): void {
  writeFileSync(envConfigPath(cwd), yaml.dump(cfg, { lineWidth: 120, noRefs: true }), "utf8");
}

export function readLocalSecrets(cwd = process.cwd()): Record<string, string> {
  const p = secretsPath(cwd);
  if (!existsSync(p)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

export function ensureGitignore(cwd = process.cwd()): void {
  const path = resolve(cwd, ".gitignore");
  let content = "";
  if (existsSync(path)) content = readFileSync(path, "utf8");
  const existing = new Set(content.split("\n").map((l) => l.trim()));
  const missing = GITIGNORE_ENTRIES.filter((e) => !existing.has(e));
  if (missing.length === 0) return;

  const additions = ["", "# Heizen", ...missing, ""].join("\n");
  if (content.length > 0 && !content.endsWith("\n")) content += "\n";
  writeFileSync(path, content + additions, "utf8");
}
