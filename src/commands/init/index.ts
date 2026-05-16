import { confirm } from "@inquirer/prompts";
import chalk from "chalk";

import { ensureGitignore, readConfig, writeConfig, writeEnvConfig } from "../../config/index.js";
import { checkPrerequisites } from "../../prereqs/index.js";
import type { HeizenConfig, HeizenEnvConfig } from "../../schema/types.js";
import { dim, failure, info, nextSteps, success } from "../../ui/index.js";
import { runGenerate } from "../generate/index.js";
import { promptAwsProfile } from "./prompts/aws-profile.js";
import { promptDataStores } from "./prompts/data-stores.js";
import { promptEnv } from "./prompts/env.js";
import { promptNetworking } from "./prompts/networking.js";
import { promptProject } from "./prompts/project.js";
import { promptServices } from "./prompts/services.js";
import { printSummary } from "./summary.js";

interface InitOptions {
  envOnly?: boolean;
}

export async function runInit(opts: InitOptions = {}): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("Heizen Infra Init"));

  await checkPrerequisites();

  if (opts.envOnly) {
    await runEnvOnly();
    return;
  }

  await runFullInit();
}

async function runEnvOnly(): Promise<void> {
  const cfg = readConfig();
  if (!cfg) {
    failure("heizen.yaml not found. Run 'heizen infra init' without --env-only.");
    process.exit(1);
  }
  dim("Configuring runtime (heizen.env.yaml) only. Infrastructure shape (heizen.yaml) untouched.");

  const envCfg = await collectEnvConfig(cfg);
  persistEnvConfig(envCfg);
  info("Next: Run 'heizen infra generate'");
}

async function runFullInit(): Promise<void> {
  dim("Generates Pulumi infrastructure for AWS ECS Fargate.");

  const cfg = await collectInfraConfig();
  const envCfg = await collectEnvConfig(cfg);

  printSummary(cfg, envCfg);

  const proceed = await confirm({ message: "Generate infrastructure code?", default: true });

  persistInfraConfig(cfg);
  persistEnvConfig(envCfg);

  if (!proceed) {
    info("Config saved. Run 'heizen infra generate' when ready.");
    return;
  }

  await runGenerate({ silent: false });

  nextSteps([
    "Run 'heizen infra deploy' to provision infrastructure",
    `Push a Docker image to ${cfg.ecr.image}:${cfg.ecr.tag}`,
    "Add DNS records (shown after deploy)",
  ]);
}

async function collectInfraConfig(): Promise<HeizenConfig> {
  const project = await promptProject();
  const networking = await promptNetworking(project.region);
  const services = await promptServices();
  const data = await promptDataStores(project.project);

  return {
    version: 1,
    project: project.project,
    env: project.env,
    region: project.region,
    domain: project.domain,
    ecr: project.ecr,
    networking,
    services,
    database: data.database,
    cache: data.cache,
    storage: data.storage,
  };
}

async function collectEnvConfig(cfg: HeizenConfig): Promise<HeizenEnvConfig> {
  const awsProfile = await promptAwsProfile();
  const env = await promptEnv(cfg);
  return { awsProfile, env };
}

function persistInfraConfig(cfg: HeizenConfig): void {
  writeConfig(cfg);
  success("Wrote heizen.yaml");
}

function persistEnvConfig(envCfg: HeizenEnvConfig): void {
  writeEnvConfig(envCfg);
  ensureGitignore();
  success("Wrote heizen.env.yaml (gitignored)");
  success(".gitignore updated");
}
