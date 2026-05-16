import { confirm, input, select } from "@inquirer/prompts";
import chalk from "chalk";

import type { HeizenConfig, HeizenEnvConfig, HeizenStudioConfig } from "../../../schema/types.js";
import { AUTO_VALUE } from "../../../schema/types.js";
import { isValidEnvVar } from "../../../schema/validator.js";
import { box, dim, section } from "../../../ui/index.js";
import { promptHeizenStudioFetch } from "./heizen-studio.js";

const VALUE_PROMPT = `Value (or "${AUTO_VALUE}" for random):`;

export interface EnvPromptResult {
  env: HeizenEnvConfig["env"];
  heizenStudio?: HeizenStudioConfig;
}

export async function promptEnv(cfg: HeizenConfig): Promise<EnvPromptResult> {
  section("Environment Variables");
  dim("All runtime configuration lives in heizen.env.yaml (gitignored).");
  console.log();
  printAutoInjected(cfg);

  const source = await promptSource();
  const { shared, heizenStudio } = source === "studio"
    ? await collectFromStudio(cfg)
    : await collectManualShared();

  const env: HeizenEnvConfig["env"] = {};
  if (Object.keys(shared).length > 0) env.shared = shared;
  await collectPerServiceVars(cfg, env, shared);

  return heizenStudio ? { env, heizenStudio } : { env };
}

async function promptSource(): Promise<"studio" | "manual"> {
  return (await select({
    message: "How do you manage env vars?",
    choices: [
      { name: "Heizen Studio (pull from studio.heizen.work)", value: "studio" },
      { name: "Manual (define here)", value: "manual" },
    ],
    default: "studio",
  })) as "studio" | "manual";
}

interface SharedResult {
  shared: Record<string, string>;
  heizenStudio?: HeizenStudioConfig;
}

async function collectFromStudio(cfg: HeizenConfig): Promise<SharedResult> {
  const result = await promptHeizenStudioFetch(cfg.env);
  if (!result) return await collectManualShared();

  const shared = { ...result.secrets };
  const addMore = await confirm({ message: "Add additional variables?", default: false });
  if (addMore) {
    const extras = await promptVarSet("Additional shared variables:", "", new Set(Object.keys(shared)));
    // Local additions override Studio values on key collision (deliberate: the
    // user just typed them, intent is clear).
    Object.assign(shared, extras);
  }
  console.log();
  return { shared, heizenStudio: result.credentials };
}

async function collectManualShared(): Promise<SharedResult> {
  const shared = await promptVarSet(
    "Shared env vars (all backend/worker services):",
    `Use "${AUTO_VALUE}" as value to generate a random secret on first deploy.`,
    new Set(),
  );
  return { shared };
}

async function collectPerServiceVars(
  cfg: HeizenConfig,
  env: HeizenEnvConfig["env"],
  shared: Record<string, string>,
): Promise<void> {
  console.log(chalk.bold("Per-service env vars:"));
  const seen = new Set(Object.keys(shared));
  for (const svc of cfg.services) {
    const yes = await confirm({ message: `Add env vars for "${svc.name}"?`, default: false });
    if (!yes) continue;
    const vars = await promptVarSet("", "", seen);
    if (Object.keys(vars).length > 0) env[svc.name] = vars;
  }
}

async function promptVarSet(
  heading: string,
  hint: string,
  seen: Set<string>,
): Promise<Record<string, string>> {
  if (heading) console.log(chalk.bold(heading));
  if (hint) dim(hint);

  const out: Record<string, string> = {};
  while (true) {
    const localHas = Object.keys(out).length > 0;
    const more = await confirm({
      message: localHas ? "Add another?" : "Add a variable?",
      default: false,
    });
    if (!more) break;
    const key = await input({
      message: "Key:",
      validate: (v) => {
        if (!isValidEnvVar(v)) return "Must be UPPER_SNAKE_CASE.";
        if (out[v] !== undefined) return "Already added in this group.";
        if (seen.has(v)) return "Already declared in another scope.";
        return true;
      },
    });
    const value = await input({ message: VALUE_PROMPT });
    out[key] = value;
    seen.add(key);
  }
  console.log();
  return out;
}

function printAutoInjected(cfg: HeizenConfig): void {
  const lines: string[] = [];
  if (cfg.database.engine === "postgres") lines.push(`DATABASE_URL    from RDS output`);
  if (cfg.cache.engine === "redis") lines.push(`REDIS_URL       from Redis output`);
  if (cfg.storage.enabled) {
    lines.push(`AWS_S3_BUCKET   from S3 output`);
    lines.push(`AWS_S3_REGION   ${cfg.region}`);
  }
  lines.push(`NODE_ENV        production`);
  console.log(chalk.bold("Auto-injected by infrastructure (you don't set these):"));
  box(lines);
  console.log();

  if (cfg.database.engine === "postgres") {
    console.log(chalk.bold("Infrastructure secret (auto-managed):"));
    box([`DB_PASSWORD     auto-generated, wired into DATABASE_URL`]);
    console.log();
  }
}
