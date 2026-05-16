import { confirm, input } from "@inquirer/prompts";
import chalk from "chalk";

import type { HeizenConfig, HeizenEnvConfig } from "../../../schema/types.js";
import { AUTO_VALUE } from "../../../schema/types.js";
import { isValidEnvVar } from "../../../schema/validator.js";
import { box, dim, section } from "../../../ui/index.js";

const VALUE_PROMPT = `Value (or "${AUTO_VALUE}" for random):`;

export async function promptEnv(cfg: HeizenConfig): Promise<HeizenEnvConfig["env"]> {
  section("Environment Variables");
  dim("All runtime configuration lives in heizen.env.yaml (gitignored).");
  console.log();
  printAutoInjected(cfg);

  const env: HeizenEnvConfig["env"] = {};
  const seen = new Set<string>();

  const shared = await promptVarSet(
    `Shared env vars (all backend/worker services):`,
    `Use "${AUTO_VALUE}" as value to generate a random secret on first deploy.`,
    seen,
  );
  if (Object.keys(shared).length > 0) env.shared = shared;

  console.log(chalk.bold("Per-service env vars:"));
  for (const svc of cfg.services) {
    const yes = await confirm({ message: `Add env vars for "${svc.name}"?`, default: false });
    if (!yes) continue;
    const vars = await promptVarSet("", "", seen);
    if (Object.keys(vars).length > 0) env[svc.name] = vars;
  }

  return env;
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
