import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import ora from "ora";

import type { HeizenConfig, HeizenEnvConfig } from "../schema/types.js";
import { success } from "../ui/index.js";
import { buildTemplateContext } from "./context.js";
import { renderTemplate } from "./render.js";
import type { TemplateContext } from "./types.js";

type FileSpec = [templateName: string, outPath: string];

export async function generateInfra(
  cfg: HeizenConfig,
  envCfg: HeizenEnvConfig,
  cwd: string,
): Promise<void> {
  const spinner = ora("Rendering templates...").start();
  const infraDir = resolve(cwd, "infra");
  const componentsDir = join(infraDir, "components");
  mkdirSync(componentsDir, { recursive: true });

  const ctx = buildTemplateContext(cfg, envCfg);
  const files = planFiles(ctx, infraDir, componentsDir);
  spinner.stop();

  for (const [templateName, outPath] of files) {
    writeFileSync(outPath, renderTemplate(templateName, ctx), "utf8");
    success(`Generated: ${outPath.replace(cwd + "/", "")}`);
  }
}

function planFiles(ctx: TemplateContext, infraDir: string, componentsDir: string): FileSpec[] {
  const files: FileSpec[] = [
    ["pulumi-yaml", join(infraDir, "Pulumi.yaml")],
    ["pulumi-stack-yaml", join(infraDir, `Pulumi.${ctx.env}.yaml`)],
    ["package-json", join(infraDir, "package.json")],
    ["tsconfig-json", join(infraDir, "tsconfig.json")],
    ["config.ts", join(infraDir, "config.ts")],
    ["networking.ts", join(componentsDir, "networking.ts")],
    ["store.ts", join(componentsDir, "store.ts")],
    ["compute.ts", join(componentsDir, "compute.ts")],
    ["index.ts", join(infraDir, "index.ts")],
  ];
  if (ctx.hasAlb) {
    files.splice(files.length - 2, 0, ["loadbalancer.ts", join(componentsDir, "loadbalancer.ts")]);
  }
  return files;
}
