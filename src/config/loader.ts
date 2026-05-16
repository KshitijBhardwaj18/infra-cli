import type { HeizenConfig, HeizenEnvConfig } from "../schema/types.js";
import { validateConfig, validateEnvConfig } from "../schema/validator.js";
import { readConfig, readEnvConfig } from "./files.js";

export interface LoadedConfigs {
  cfg: HeizenConfig;
  envCfg: HeizenEnvConfig;
}

// Reads both YAML files and runs validation. Throws if either is missing
// or invalid, so callers can rely on a fully-typed result.
export function loadValidatedConfigs(cwd = process.cwd()): LoadedConfigs {
  const rawCfg = readConfig(cwd);
  if (!rawCfg) throw new Error("heizen.yaml not found. Run 'heizen infra init' first.");
  const rawEnv = readEnvConfig(cwd);
  if (!rawEnv) throw new Error("heizen.env.yaml not found. Run 'heizen infra init --env-only' first.");
  return { cfg: validateConfig(rawCfg), envCfg: validateEnvConfig(rawEnv) };
}
