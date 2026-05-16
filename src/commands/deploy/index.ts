import { existsSync } from "node:fs";
import { execa } from "execa";
import ora from "ora";
import chalk from "chalk";

import { infraDirPath, loadValidatedConfigs } from "../../config/index.js";
import {
  PulumiCtx, buildPulumiCtx, ensureStateBucket, formatExecError, stateBucketName,
} from "../../pulumi/index.js";
import type { HeizenConfig, HeizenEnvConfig } from "../../schema/types.js";
import { failure, info, nextSteps, section, success } from "../../ui/index.js";
import { provisionEnvVars } from "./env-provision.js";
import {
  fetchStackOutputs, printCertValidation, printDnsRecords, printOutputs,
} from "./outputs.js";

export async function runDeploy(): Promise<void> {
  const cwd = process.cwd();
  const infraDir = infraDirPath(cwd);
  if (!existsSync(infraDir)) {
    failure("infra/ directory not found. Run 'heizen infra generate' first.");
    process.exit(1);
  }

  const { cfg, envCfg } = loadValidatedConfigs(cwd);

  section(`Deploying ${cfg.project} (${cfg.env})`);
  console.log(`  Region:  ${cfg.region}`);
  console.log(`  Profile: ${envCfg.awsProfile}`);
  console.log();

  await verifyAwsCredentials(envCfg);
  await ensureStateBucket(cfg, envCfg);

  const pCtx = buildPulumiCtx(envCfg, infraDir);
  await loginToBackend(cfg, pCtx);
  await ensureStack(cfg, pCtx);
  await execa("pulumi", ["config", "set", "aws:region", cfg.region], pCtx);

  console.log();
  section("Environment Variables");
  await provisionEnvVars(cfg, envCfg, pCtx);
  console.log();

  printDeployPlan(cfg);
  await pulumiUp(pCtx);
  success("Infrastructure deployed successfully!");

  const outputs = await fetchStackOutputs(pCtx);
  printOutputs(outputs);
  printDnsRecords(cfg, outputs);
  printCertValidation(outputs);

  const firstDomain = cfg.services.find((s) => s.domain)?.domain;
  nextSteps([
    "Add the DNS records above to your DNS provider",
    `Push a Docker image: docker push ${cfg.ecr.image}:${cfg.ecr.tag}`,
    firstDomain ? `Verify: curl https://${firstDomain}` : "Confirm services are healthy in the ECS console",
  ]);
}

async function verifyAwsCredentials(envCfg: HeizenEnvConfig): Promise<void> {
  const spinner = ora("Checking AWS credentials...").start();
  try {
    const { stdout } = await execa(
      "aws",
      ["sts", "get-caller-identity", "--profile", envCfg.awsProfile, "--output", "json"],
    );
    const id = JSON.parse(stdout);
    spinner.succeed(`Authenticated as ${id.Arn} (account: ${id.Account})`);
  } catch {
    spinner.fail(`AWS credentials not configured. Run 'aws configure --profile ${envCfg.awsProfile}'`);
    process.exit(1);
  }
}

async function loginToBackend(cfg: HeizenConfig, pCtx: PulumiCtx): Promise<void> {
  try {
    await execa("pulumi", ["login", `s3://${stateBucketName(cfg)}`], pCtx);
    success("Connected to Pulumi backend");
  } catch (err) {
    failure("Failed to connect to Pulumi state backend");
    console.log(formatExecError(err));
    process.exit(1);
  }
}

async function ensureStack(cfg: HeizenConfig, pCtx: PulumiCtx): Promise<void> {
  try {
    const { stdout } = await execa("pulumi", ["stack", "ls"], pCtx);
    const exists = stdout.split("\n").some((l) => l.trim().startsWith(cfg.env));
    await execa("pulumi", ["stack", exists ? "select" : "init", cfg.env], pCtx);
    success(`Stack: ${cfg.env}`);
  } catch (err) {
    failure("Failed to set up Pulumi stack");
    console.log(formatExecError(err));
    process.exit(1);
  }
}

function printDeployPlan(cfg: HeizenConfig): void {
  console.log();
  info("Starting deployment... This typically takes 15-20 minutes.");
  console.log();
  console.log("  Creating:");
  console.log("  • VPC, Subnets, NAT Gateway, Internet Gateway");
  console.log("  • Security Groups (ALB → ECS → RDS → Redis)");
  if (cfg.services.some((s) => s.domain)) {
    console.log("  • Application Load Balancer, Target Groups, Routing Rules");
    console.log(`  • ACM Certificate (*.${cfg.domain})`);
  }
  if (cfg.database.engine === "postgres") console.log(`  • RDS PostgreSQL (${cfg.database.size})`);
  if (cfg.cache.engine === "redis") console.log(`  • ElastiCache Redis (${cfg.cache.size})`);
  if (cfg.storage.enabled) console.log("  • S3 Bucket");
  console.log(`  • ECS Cluster, ${cfg.services.length} Service(s), Auto-scaling`);
  console.log("  • CloudWatch Log Groups, IAM Roles");
  console.log();
}

async function pulumiUp(pCtx: PulumiCtx): Promise<void> {
  try {
    await execa("pulumi", ["up", "--yes", "--non-interactive"], { ...pCtx, stdio: "inherit" });
  } catch (err) {
    failure("Deployment failed");
    console.log(chalk.dim(formatExecError(err)));
    console.log();
    console.log("Fix the error and run 'heizen infra deploy' again");
    console.log("Or run 'cd infra && pulumi up' to retry interactively");
    process.exit(1);
  }
}
