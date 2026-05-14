#!/usr/bin/env node
import { Command } from "commander";
import chalk from "chalk";
import { runInit } from "./commands/init.js";
import { runDeploy } from "./commands/deploy.js";
import { runDestroy } from "./commands/destroy.js";
import { runGenerate } from "./commands/generate.js";
const program = new Command();
program
    .name("heizen")
    .description("Provision AWS ECS Fargate infrastructure with a single command")
    .version("0.1.0");
const infra = program.command("infra").description("Manage infrastructure");
infra
    .command("init")
    .description("Configure project and generate infrastructure code")
    .option("--env-only", "Configure heizen.env.yaml only (heizen.yaml must already exist)")
    .action(async (opts) => {
    try {
        await runInit({ envOnly: !!opts.envOnly });
    }
    catch (err) {
        handleError(err);
    }
});
infra
    .command("generate")
    .description("Generate infra/ from heizen.yaml + heizen.env.yaml")
    .action(async () => {
    try {
        await runGenerate();
    }
    catch (err) {
        handleError(err);
    }
});
infra
    .command("deploy")
    .description("Provision secrets and deploy infrastructure to AWS")
    .action(async () => {
    try {
        await runDeploy();
    }
    catch (err) {
        handleError(err);
    }
});
infra
    .command("destroy")
    .description("Destroy all provisioned infrastructure")
    .action(async () => {
    try {
        await runDestroy();
    }
    catch (err) {
        handleError(err);
    }
});
program.parseAsync(process.argv);
function handleError(err) {
    if (err instanceof Error) {
        if (err.name === "ExitPromptError") {
            console.log();
            console.log(chalk.yellow("Cancelled."));
            process.exit(0);
        }
        console.log();
        console.log(chalk.red(`✗ ${err.message}`));
    }
    else {
        console.log(chalk.red(`✗ ${String(err)}`));
    }
    process.exit(1);
}
//# sourceMappingURL=index.js.map