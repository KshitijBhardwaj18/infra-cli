import {
  PulumiCtx, setRandomSecretIfMissing, setSecretIfMissing,
} from "../../pulumi/index.js";
import type { HeizenConfig, HeizenEnvConfig } from "../../schema/types.js";
import { AUTO_VALUE } from "../../schema/types.js";
import { envVarToCamelCase } from "../../schema/validator.js";
import { header, info } from "../../ui/index.js";

const DB_PASSWORD_KEY = "dbPassword";

// Walks heizen.env.yaml, ensuring every env var is set in Pulumi config.
// AUTO_VALUE entries get a random hex secret; everything else is set verbatim.
// Already-configured keys are skipped (so re-deploys are no-ops).
export async function provisionEnvVars(
  cfg: HeizenConfig,
  envCfg: HeizenEnvConfig,
  pCtx: PulumiCtx,
): Promise<void> {
  const hasDb = cfg.database.engine === "postgres";
  const scopes = Object.entries(envCfg.env).filter(
    (e): e is [string, Record<string, string>] => e[1] !== undefined && Object.keys(e[1]).length > 0,
  );
  if (!hasDb && scopes.length === 0) {
    info("No env vars to provision.");
    return;
  }

  if (hasDb) {
    header("  Infrastructure:");
    await setRandomSecretIfMissing(DB_PASSWORD_KEY, pCtx, "dbPassword");
    console.log();
  }

  for (const [scope, vars] of scopes) {
    header(`  ${scope}:`);
    await provisionScope(vars, pCtx);
    console.log();
  }
}

async function provisionScope(vars: Record<string, string>, pCtx: PulumiCtx): Promise<void> {
  for (const [envVar, value] of Object.entries(vars)) {
    const key = envVarToCamelCase(envVar);
    if (value === AUTO_VALUE) {
      await setRandomSecretIfMissing(key, pCtx, envVar);
    } else {
      await setSecretIfMissing(key, value, pCtx, envVar);
    }
  }
}
