#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";

import { runDeploy } from "./commands/deploy/index.js";
import { runDestroy } from "./commands/destroy/index.js";
import { runGenerate } from "./commands/generate/index.js";
import { runInit } from "./commands/init/index.js";

const program = new Command();

program
  .name("heizen")
  .description("Autamaiting infra provision")
  .version("0.1.0");

const infra = program.command("infra").description("Manage infrastructure");

infra
  .command("init")
  .description("Configure project and generate infrastructure code")
  .option("--env-only", "Configure heizen.env.yaml only (heizen.yaml must already exist)")
  .action((opts: { envOnly?: boolean }) =>
    runInit({ envOnly: !!opts.envOnly }).catch(handleError),
  );

infra
  .command("generate")
  .description("Generate infra/ from heizen.yaml + heizen.env.yaml")
  .action(() => runGenerate().catch(handleError));

infra
  .command("deploy")
  .description("Provision secrets and deploy infrastructure to AWS")
  .action(() => runDeploy().catch(handleError));

infra
  .command("destroy")
  .description("Destroy all provisioned infrastructure")
  .action(() => runDestroy().catch(handleError));

program.parseAsync(process.argv);

function handleError(err: unknown): never {
  if (err instanceof Error && err.name === "ExitPromptError") {
    console.log();
    console.log(chalk.yellow("Cancelled."));
    process.exit(0);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.log();
  console.log(chalk.red(`✗ ${message}`));
  process.exit(1);
}
