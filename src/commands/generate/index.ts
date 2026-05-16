import { existsSync, rmSync } from "node:fs";
import { confirm } from "@inquirer/prompts";
import { execa } from "execa";
import ora from "ora";

import { infraDirPath, loadValidatedConfigs } from "../../config/index.js";
import { generateInfra } from "../../generator/index.js";
import { info } from "../../ui/index.js";

interface GenerateOptions {
  silent?: boolean;
}

export async function runGenerate(opts: GenerateOptions = {}): Promise<void> {
  const cwd = process.cwd();
  const { cfg, envCfg } = loadValidatedConfigs(cwd);

  const infraDir = infraDirPath(cwd);
  if (existsSync(infraDir)) {
    const overwrite = await confirm({ message: "infra/ directory exists. Overwrite?", default: true });
    if (!overwrite) {
      info("Aborted.");
      return;
    }
    rmSync(infraDir, { recursive: true, force: true });
  }

  if (!opts.silent) info("Generating infrastructure code...");
  await generateInfra(cfg, envCfg, cwd);
  await installDependencies(infraDir);

  if (!opts.silent) info("Next: Run 'heizen infra deploy'");
}

async function installDependencies(infraDir: string): Promise<void> {
  const spinner = ora("Installing dependencies...").start();
  try {
    await execa("npm", ["install"], { cwd: infraDir });
    spinner.succeed("Dependencies installed");
  } catch {
    spinner.fail("npm install failed (run 'npm install' manually in ./infra)");
  }
}
