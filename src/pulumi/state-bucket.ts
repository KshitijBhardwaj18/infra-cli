import { execa } from "execa";
import ora from "ora";

import type { HeizenConfig, HeizenEnvConfig } from "../schema/types.js";
import { formatExecError } from "./errors.js";

const DEFAULT_REGION = "us-east-1";

export function stateBucketName(cfg: HeizenConfig): string {
  return `${cfg.project}-pulumi-state`;
}

// Idempotent. Creates the bucket on first deploy; subsequent calls no-op.
export async function ensureStateBucket(cfg: HeizenConfig, envCfg: HeizenEnvConfig): Promise<void> {
  const bucket = stateBucketName(cfg);
  const spinner = ora("Setting up Pulumi state backend...").start();
  if (await bucketExists(bucket, envCfg)) {
    spinner.succeed(`Using existing state bucket: ${bucket}`);
    return;
  }
  spinner.text = `Creating state bucket: ${bucket}`;
  try {
    await createBucket(bucket, cfg, envCfg);
    await enableVersioning(bucket, envCfg);
    spinner.succeed(`State bucket created: ${bucket}`);
  } catch (err) {
    spinner.fail(`Failed to create state bucket`);
    throw new Error(`State bucket creation failed: ${formatExecError(err)}`);
  }
}

async function bucketExists(bucket: string, envCfg: HeizenEnvConfig): Promise<boolean> {
  try {
    await execa(
      "aws",
      ["s3api", "head-bucket", "--bucket", bucket, "--profile", envCfg.awsProfile],
      { stderr: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

async function createBucket(bucket: string, cfg: HeizenConfig, envCfg: HeizenEnvConfig): Promise<void> {
  const args = ["s3", "mb", `s3://${bucket}`, "--profile", envCfg.awsProfile];
  if (cfg.region !== DEFAULT_REGION) args.push("--region", cfg.region);
  await execa("aws", args);
}

async function enableVersioning(bucket: string, envCfg: HeizenEnvConfig): Promise<void> {
  await execa("aws", [
    "s3api", "put-bucket-versioning",
    "--bucket", bucket,
    "--versioning-configuration", "Status=Enabled",
    "--profile", envCfg.awsProfile,
  ]);
}
