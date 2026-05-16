import { randomBytes } from "node:crypto";
import { execa } from "execa";

import { success } from "../ui/log.js";
import { PulumiCtx, pulumiConfigExists } from "./client.js";

const RANDOM_SECRET_BYTES = 32;

export async function setSecretIfMissing(
  pulumiKey: string,
  value: string,
  pCtx: PulumiCtx,
  label: string,
): Promise<void> {
  if (await pulumiConfigExists(pulumiKey, pCtx)) {
    success(`${label} (already configured)`);
    return;
  }
  await writeSecret(pulumiKey, value, pCtx);
  success(`${label} (set)`);
}

export async function setRandomSecretIfMissing(
  pulumiKey: string,
  pCtx: PulumiCtx,
  label: string,
): Promise<void> {
  if (await pulumiConfigExists(pulumiKey, pCtx)) {
    success(`${label} (already configured)`);
    return;
  }
  await writeSecret(pulumiKey, randomHex(), pCtx);
  success(`${label} (generated)`);
}

function randomHex(): string {
  return randomBytes(RANDOM_SECRET_BYTES).toString("hex");
}

async function writeSecret(key: string, value: string, pCtx: PulumiCtx): Promise<void> {
  await execa("pulumi", ["config", "set", "--secret", key, value], pCtx);
}
