import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import yaml from "js-yaml";

import type { HeizenConfig, HeizenEnvConfig } from "../schema/types.js";

export const CONFIG_FILE = "heizen.yaml";
export const ENV_CONFIG_FILE = "heizen.env.yaml";
export const INFRA_DIR = "infra";

export function configPath(cwd = process.cwd()): string {
  return resolve(cwd, CONFIG_FILE);
}

export function envConfigPath(cwd = process.cwd()): string {
  return resolve(cwd, ENV_CONFIG_FILE);
}

export function infraDirPath(cwd = process.cwd()): string {
  return resolve(cwd, INFRA_DIR);
}

export function readConfig(cwd = process.cwd()): HeizenConfig | null {
  return readYaml<HeizenConfig>(configPath(cwd));
}

export function readEnvConfig(cwd = process.cwd()): HeizenEnvConfig | null {
  return readYaml<HeizenEnvConfig>(envConfigPath(cwd));
}

export function writeConfig(cfg: HeizenConfig, cwd = process.cwd()): void {
  writeYaml(configPath(cwd), cfg);
}

export function writeEnvConfig(cfg: HeizenEnvConfig, cwd = process.cwd()): void {
  writeYaml(envConfigPath(cwd), cfg);
}

function readYaml<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  return yaml.load(readFileSync(path, "utf8")) as T;
}

function writeYaml(path: string, value: unknown): void {
  writeFileSync(path, yaml.dump(value, { lineWidth: 120, noRefs: true }), "utf8");
}
