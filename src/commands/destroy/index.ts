import { existsSync } from "node:fs";
import { confirm, input } from "@inquirer/prompts";
import { execa } from "execa";
import ora from "ora";
import chalk from "chalk";

import { infraDirPath, loadValidatedConfigs } from "../../config/index.js";
import {
  PulumiCtx, buildPulumiCtx, formatExecError, stateBucketName,
} from "../../pulumi/index.js";
import type { HeizenConfig, HeizenEnvConfig } from "../../schema/types.js";
import { failure, success, warn, warnBox } from "../../ui/index.js";

export async function runDestroy(): Promise<void> {
  const cwd = process.cwd();
  const infraDir = infraDirPath(cwd);
  if (!existsSync(infraDir)) {
    failure("infra/ directory not found.");
    process.exit(1);
  }

  const { cfg, envCfg } = loadValidatedConfigs(cwd);

  printWarning(cfg);
  await confirmDestruction(cfg);
  await disableRdsProtectionIfNeeded(cfg, envCfg);

  const pCtx = buildPulumiCtx(envCfg, infraDir);
  await connectToBackend(cfg, pCtx);
  await pulumiDestroy(pCtx);

  success("Infrastructure destroyed.");
  await maybeDeleteStateBucket(cfg, envCfg);

  console.log();
  console.log("Cleanup complete.");
}

function printWarning(cfg: HeizenConfig): void {
  const lines: string[] = [
    "                    WARNING",
    "---",
    "This will permanently destroy ALL infrastructure",
    `for project '${cfg.project}' (${cfg.env})`,
    "",
    "Resources to be destroyed:",
    "  • VPC, Subnets, NAT Gateway",
  ];
  if (cfg.services.some((s) => s.domain)) lines.push("  • Load Balancer, Target Groups");
  lines.push("  • ECS Cluster, all services");
  if (cfg.database.engine === "postgres") lines.push("  • RDS Database (ALL DATA WILL BE LOST)");
  if (cfg.cache.engine === "redis") lines.push("  • Redis Cache");
  if (cfg.storage.enabled) lines.push("  • S3 Bucket and all contents");
  lines.push("  • CloudWatch Logs, IAM Roles");
  lines.push("");
  lines.push("This action CANNOT be undone.");

  console.log();
  warnBox(lines);
  console.log();
}

async function confirmDestruction(cfg: HeizenConfig): Promise<void> {
  const typed = await input({ message: "Type the project name to confirm:" });
  if (typed !== cfg.project) {
    failure("Project name doesn't match. Aborting.");
    process.exit(1);
  }
}

async function disableRdsProtectionIfNeeded(cfg: HeizenConfig, envCfg: HeizenEnvConfig): Promise<void> {
  if (cfg.database.engine !== "postgres" || !cfg.database.deletionProtection) return;

  console.log();
  warn("RDS has deletion protection enabled.");
  const proceed = await confirm({
    message: "Temporarily disable deletion protection to proceed?",
    default: false,
  });
  if (!proceed) {
    console.log("Aborting. Disable deletion protection manually or set deletionProtection: false in heizen.yaml");
    process.exit(0);
  }

  const spinner = ora("Disabling RDS deletion protection...").start();
  try {
    await execa("aws", [
      "rds", "modify-db-instance",
      "--db-instance-identifier", `${cfg.project}-${cfg.env}-db`,
      "--no-deletion-protection",
      "--apply-immediately",
      "--profile", envCfg.awsProfile,
      "--region", cfg.region,
    ]);
    spinner.succeed("Deletion protection disabled");
  } catch (err) {
    spinner.fail("Failed to disable deletion protection");
    console.log(formatExecError(err));
    process.exit(1);
  }
}

async function connectToBackend(cfg: HeizenConfig, pCtx: PulumiCtx): Promise<void> {
  try {
    await execa("pulumi", ["login", `s3://${stateBucketName(cfg)}`], pCtx);
    await execa("pulumi", ["stack", "select", cfg.env], pCtx);
  } catch (err) {
    failure("Failed to connect to Pulumi state backend");
    console.log(formatExecError(err));
    process.exit(1);
  }
}

async function pulumiDestroy(pCtx: PulumiCtx): Promise<void> {
  try {
    await execa("pulumi", ["destroy", "--yes", "--non-interactive"], { ...pCtx, stdio: "inherit" });
  } catch (err) {
    failure("Destroy failed");
    console.log(chalk.dim(formatExecError(err)));
    console.log();
    console.log("Some resources may not have been destroyed. Check the AWS Console.");
    process.exit(1);
  }
}

async function maybeDeleteStateBucket(cfg: HeizenConfig, envCfg: HeizenEnvConfig): Promise<void> {
  const bucket = stateBucketName(cfg);
  const yes = await confirm({
    message: `Delete Pulumi state bucket (${bucket})? This removes the encrypted secret config too.`,
    default: false,
  });
  if (!yes) return;

  const spinner = ora(`Deleting ${bucket}...`).start();
  try {
    await execa("aws", [
      "s3", "rb", `s3://${bucket}`, "--force",
      "--profile", envCfg.awsProfile, "--region", cfg.region,
    ]);
    spinner.succeed("State bucket deleted");
  } catch {
    spinner.fail("Could not delete state bucket (delete manually if needed)");
  }
}
