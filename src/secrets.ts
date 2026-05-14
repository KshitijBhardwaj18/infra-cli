import { randomBytes } from "node:crypto";
import { execa, ExecaError } from "execa";
import { password } from "@inquirer/prompts";
import ora from "ora";

import type { HeizenConfig, HeizenEnvConfig, SecretSpec } from "./schema/types.js";
import { readLocalSecrets } from "./files.js";
import { success, info, warn, failure } from "./ui.js";

interface Ctx {
  prefix: string;
  region: string;
  awsProfile: string;
}

export async function resolveAndProvisionSecrets(
  cfg: HeizenConfig,
  envCfg: HeizenEnvConfig,
): Promise<void> {
  const ctx: Ctx = {
    prefix: `${cfg.project}-${cfg.env}`,
    region: cfg.region,
    awsProfile: envCfg.awsProfile,
  };
  const local = readLocalSecrets();

  info("Resolving secrets...");

  for (const spec of envCfg.secrets.generated) {
    await provisionGenerated(spec, ctx);
  }
  for (const spec of envCfg.secrets.manual) {
    await provisionManual(spec, ctx, local);
  }
}

async function provisionGenerated(spec: SecretSpec, ctx: Ctx): Promise<void> {
  const fullName = `${ctx.prefix}/${spec.name}`;
  if (await secretExists(fullName, ctx)) {
    success(`${spec.name} (already in Secrets Manager)`);
    return;
  }
  const value = generateRandomValue();
  await createSecret(fullName, value, ctx);
  success(`${spec.name} (generated and stored)`);
}

async function provisionManual(
  spec: SecretSpec,
  ctx: Ctx,
  local: Record<string, string>,
): Promise<void> {
  const fullName = `${ctx.prefix}/${spec.name}`;

  if (await secretExists(fullName, ctx)) {
    success(`${spec.name} (already in Secrets Manager)`);
    return;
  }

  const envVarName = `HEIZEN_SECRET_${spec.envVar}`;
  const fromEnv = process.env[envVarName];
  if (fromEnv) {
    await createSecret(fullName, fromEnv, ctx);
    success(`${spec.name} (loaded from ${envVarName})`);
    return;
  }

  const fromFile = local[spec.envVar];
  if (fromFile) {
    await createSecret(fullName, fromFile, ctx);
    success(`${spec.name} (loaded from .heizen.secrets)`);
    return;
  }

  warn(`${spec.name} is required. Provide its value below (input is masked).`);
  const value = await password({
    message: `Value for ${spec.envVar}:`,
    mask: "*",
    validate: (v) => v.length > 0 || "A value is required.",
  });
  await createSecret(fullName, value, ctx);
  success(`${spec.name} (prompted and stored)`);
}

async function secretExists(fullName: string, ctx: Ctx): Promise<boolean> {
  try {
    await execa(
      "aws",
      [
        "secretsmanager", "describe-secret",
        "--secret-id", fullName,
        "--profile", ctx.awsProfile,
        "--region", ctx.region,
      ],
      { stderr: "ignore" },
    );
    return true;
  } catch {
    return false;
  }
}

async function createSecret(fullName: string, value: string, ctx: Ctx): Promise<void> {
  const spinner = ora(`Storing ${fullName}...`).start();
  try {
    await execa("aws", [
      "secretsmanager", "create-secret",
      "--name", fullName,
      "--secret-string", value,
      "--profile", ctx.awsProfile,
      "--region", ctx.region,
    ]);
    spinner.stop();
  } catch (err) {
    spinner.stop();
    if (err instanceof ExecaError && (err.stderr ?? "").toString().includes("ResourceExistsException")) {
      return;
    }
    failure(`Could not create secret ${fullName}`);
    throw err;
  }
}

export async function deleteAllProjectSecrets(
  cfg: HeizenConfig,
  awsProfile: string,
): Promise<string[]> {
  const prefix = `${cfg.project}-${cfg.env}/`;
  const deleted: string[] = [];

  const { stdout } = await execa("aws", [
    "secretsmanager", "list-secrets",
    "--profile", awsProfile,
    "--region", cfg.region,
    "--output", "json",
  ]);
  const list = JSON.parse(stdout) as { SecretList: Array<{ Name: string }> };

  for (const s of list.SecretList ?? []) {
    if (!s.Name.startsWith(prefix)) continue;
    try {
      await execa("aws", [
        "secretsmanager", "delete-secret",
        "--secret-id", s.Name,
        "--force-delete-without-recovery",
        "--profile", awsProfile,
        "--region", cfg.region,
      ]);
      deleted.push(s.Name);
    } catch {}
  }
  return deleted;
}

function generateRandomValue(): string {
  return randomBytes(32).toString("hex");
}
