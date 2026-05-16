import { execa } from "execa";

import type { HeizenEnvConfig } from "../schema/types.js";
import { DEFAULT_PASSPHRASE } from "./errors.js";

export interface PulumiCtx {
  env: NodeJS.ProcessEnv;
  cwd: string;
}

export function buildPulumiCtx(envCfg: HeizenEnvConfig, infraDir: string): PulumiCtx {
  return {
    env: {
      ...process.env,
      PULUMI_CONFIG_PASSPHRASE: process.env.PULUMI_CONFIG_PASSPHRASE ?? DEFAULT_PASSPHRASE,
      AWS_PROFILE: envCfg.awsProfile,
    },
    cwd: infraDir,
  };
}

export async function pulumiConfigExists(key: string, pCtx: PulumiCtx): Promise<boolean> {
  try {
    await execa("pulumi", ["config", "get", key], { ...pCtx, stderr: "ignore" });
    return true;
  } catch {
    return false;
  }
}
