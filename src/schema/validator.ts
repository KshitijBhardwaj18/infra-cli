import type { HeizenConfig, HeizenEnvConfig } from "./types.js";

const REQUIRED_FIELDS = [
  "project", "env", "region", "domain", "ecr",
  "services", "database", "cache", "storage", "networking",
] as const;

export function validateConfig(raw: unknown): HeizenConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("heizen.yaml is empty or invalid");
  }
  const c = raw as Record<string, unknown>;

  for (const key of REQUIRED_FIELDS) {
    if (c[key] === undefined) throw new Error(`heizen.yaml missing required field: ${key}`);
  }

  const services = c.services;
  if (!Array.isArray(services) || services.length === 0) {
    throw new Error("heizen.yaml must declare at least one service");
  }

  for (const svc of services) {
    if (!svc?.name || !svc.type || !svc.cpu || !svc.scaling || !svc.command) {
      throw new Error(`Service "${svc?.name ?? "?"}" is missing required fields`);
    }
    if ((svc.type === "backend" || svc.type === "frontend") && !svc.port) {
      throw new Error(`Service "${svc.name}" (${svc.type}) must declare a port`);
    }
  }

  const ecr = c.ecr as { image?: string; tag?: string } | undefined;
  if (!ecr?.image || !ecr.tag) {
    throw new Error("heizen.yaml: ecr.image and ecr.tag are required");
  }

  return c as unknown as HeizenConfig;
}

export function validateEnvConfig(raw: unknown): HeizenEnvConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("heizen.env.yaml is empty or invalid");
  }
  const c = raw as Record<string, unknown>;
  if (typeof c.awsProfile !== "string" || !c.awsProfile) {
    throw new Error("heizen.env.yaml missing awsProfile");
  }
  if (!c.env || typeof c.env !== "object") c.env = {};

  const env = c.env as Record<string, Record<string, string> | undefined>;
  const seen = new Map<string, string>(); // envVar -> scope where first seen

  for (const [scope, vars] of Object.entries(env)) {
    if (vars === undefined) continue;
    if (typeof vars !== "object" || Array.isArray(vars)) {
      throw new Error(`heizen.env.yaml: env.${scope} must be an object of KEY: value pairs`);
    }
    for (const [key, value] of Object.entries(vars)) {
      if (!isValidEnvVar(key)) {
        throw new Error(`heizen.env.yaml: env.${scope}.${key} must be UPPER_SNAKE_CASE`);
      }
      if (typeof value !== "string") {
        throw new Error(`heizen.env.yaml: env.${scope}.${key} must be a string (got ${typeof value})`);
      }
      const prior = seen.get(key);
      if (prior) {
        throw new Error(
          `heizen.env.yaml: env var "${key}" appears in env.${prior} and env.${scope}. ` +
          `Each env var must be unique across scopes (it maps to one Pulumi config key).`,
        );
      }
      seen.set(key, scope);
    }
  }

  return c as unknown as HeizenEnvConfig;
}

export function isKebabCase(value: string): boolean {
  return /^[a-z][a-z0-9-]*[a-z0-9]$/.test(value);
}

export function isValidDomain(value: string): boolean {
  return /^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(value);
}

export function isValidEnvVar(value: string): boolean {
  return /^[A-Z_][A-Z0-9_]*$/.test(value);
}

// AUTH_SECRET -> authSecret. Used as the Pulumi config key for an env var.
export function envVarToCamelCase(envVar: string): string {
  return envVar
    .toLowerCase()
    .split("_")
    .filter((p) => p.length > 0)
    .map((part, i) => i === 0 ? part : part[0].toUpperCase() + part.slice(1))
    .join("");
}
