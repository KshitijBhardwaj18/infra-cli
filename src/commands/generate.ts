import { existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";
import { confirm } from "@inquirer/prompts";
import { execa } from "execa";
import ora from "ora";

import { readConfig, readEnvConfig } from "../files.js";
import { validateConfig, validateEnvConfig } from "../schema/validator.js";
import { failure, info, success } from "../ui.js";
import { generateInfra } from "../generator/index.js";

export async function runGenerate(opts: { silent?: boolean } = {}): Promise<void> {
  const cwd = process.cwd();
  const rawCfg = readConfig(cwd);
  if (!rawCfg) {
    failure("heizen.yaml not found. Run 'heizen infra init' first.");
    process.exit(1);
  }
  const rawEnv = readEnvConfig(cwd);
  if (!rawEnv) {
    failure("heizen.env.yaml not found. Run 'heizen infra init --env-only' to create it.");
    process.exit(1);
  }

  const cfg = validateConfig(rawCfg);
  const envCfg = validateEnvConfig(rawEnv);

  const infraDir = resolve(cwd, "infra");
  if (existsSync(infraDir)) {
    const overwrite = await confirm({
      message: "infra/ directory exists. Overwrite?",
      default: true,
    });
    if (!overwrite) {
      info("Aborted.");
      return;
    }
    rmSync(infraDir, { recursive: true, force: true });
  }

  if (!opts.silent) info("Generating infrastructure code...");
  await generateInfra(cfg, envCfg, cwd);

  const spinner = ora("Installing dependencies...").start();
  try {
    await execa("npm", ["install"], { cwd: infraDir });
    spinner.succeed("Dependencies installed");
  } catch {
    spinner.fail("npm install failed (run 'npm install' manually in ./infra)");
  }

  if (!opts.silent) info("Next: Run 'heizen infra deploy'");
}
