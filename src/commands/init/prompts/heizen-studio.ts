import { input, select } from "@inquirer/prompts";
import { SecretsClient, SecretsClientError } from "@heizen-labs/secrets-sdk";
import type { SecretsMap } from "@heizen-labs/secrets-sdk";
import ora from "ora";

import type { HeizenStudioConfig } from "../../../schema/types.js";
import { failure, info } from "../../../ui/index.js";

export interface StudioFetchResult {
  credentials: HeizenStudioConfig;
  secrets: SecretsMap;
}

// Prompts for Studio credentials, fetches secrets, and retries on failure.
// Returns null if the user opts to fall back to manual entry.
export async function promptHeizenStudioFetch(defaultEnvironment: string): Promise<StudioFetchResult | null> {
  while (true) {
    const credentials = await promptCredentials(defaultEnvironment);
    const secrets = await fetchSecrets(credentials);
    if (secrets) {
      printKeysFound(secrets);
      return { credentials, secrets };
    }
    const next = await select({
      message: "Retry or switch to manual?",
      choices: [
        { name: "Retry with different credentials", value: "retry" },
        { name: "Switch to manual entry", value: "manual" },
      ],
      default: "retry",
    });
    if (next === "manual") return null;
  }
}

async function promptCredentials(defaultEnvironment: string): Promise<HeizenStudioConfig> {
  const projectId = await input({
    message: "Project ID:",
    validate: (v) => v.trim().length > 0 || "Project ID is required.",
  });
  const environment = await input({
    message: "Environment:",
    default: defaultEnvironment,
    validate: (v) => v.trim().length > 0 || "Environment is required.",
  });
  // Plain input (not password) — heizen.env.yaml is gitignored and masking
  // makes pastes error-prone.
  const apiKey = await input({
    message: "API Key:",
    validate: (v) => v.trim().length > 0 || "API key is required.",
  });
  return { projectId: projectId.trim(), environment: environment.trim(), apiKey: apiKey.trim() };
}

async function fetchSecrets(credentials: HeizenStudioConfig): Promise<SecretsMap | null> {
  const spinner = ora("Fetching env vars from Heizen Studio...").start();
  try {
    const client = new SecretsClient(credentials);
    const secrets = await client.getSecrets();
    spinner.succeed(`Found ${Object.keys(secrets).length} env vars`);
    return secrets;
  } catch (err) {
    spinner.fail("Could not fetch secrets from Heizen Studio");
    failure(formatStudioError(err));
    return null;
  }
}

function formatStudioError(err: unknown): string {
  if (err instanceof SecretsClientError) {
    if (err.status === 401 || err.status === 403) {
      return `${err.message} (check that your API key is valid for this project)`;
    }
    if (err.status === 404) {
      return `${err.message} (project or environment not found)`;
    }
    return err.message;
  }
  return err instanceof Error ? err.message : String(err);
}

// SECURITY: only key names are ever printed; values stay in memory and end up
// encrypted in Pulumi config during deploy.
function printKeysFound(secrets: SecretsMap): void {
  info("  Variables found:");
  for (const key of Object.keys(secrets)) {
    console.log(`    ${key}`);
  }
}
