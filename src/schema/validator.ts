import type { HeizenConfig, HeizenEnvConfig } from "./types.js";

export function validateConfig(raw: unknown): HeizenConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("heizen.yaml is empty or invalid");
  }
  const c = raw as Record<string, any>;

  const required = ["project", "env", "region", "domain", "ecr", "services", "database", "cache", "storage", "networking"];
  for (const key of required) {
    if (c[key] === undefined) throw new Error(`heizen.yaml missing required field: ${key}`);
  }

  if (!Array.isArray(c.services) || c.services.length === 0) {
    throw new Error("heizen.yaml must declare at least one service");
  }

  for (const svc of c.services) {
    if (!svc.name || !svc.type || !svc.cpu || !svc.scaling || !svc.command) {
      throw new Error(`Service "${svc?.name ?? "?"}" is missing required fields`);
    }
    if ((svc.type === "backend" || svc.type === "frontend") && !svc.port) {
      throw new Error(`Service "${svc.name}" (${svc.type}) must declare a port`);
    }
  }

  if (!c.ecr.image || !c.ecr.tag) {
    throw new Error("heizen.yaml: ecr.image and ecr.tag are required");
  }

  return c as HeizenConfig;
}

export function validateEnvConfig(raw: unknown): HeizenEnvConfig {
  if (!raw || typeof raw !== "object") {
    throw new Error("heizen.env.yaml is empty or invalid");
  }
  const c = raw as Record<string, any>;
  if (!c.awsProfile) throw new Error("heizen.env.yaml missing awsProfile");
  if (!Array.isArray(c.generate)) c.generate = [];
  if (!c.secrets || typeof c.secrets !== "object" || Array.isArray(c.secrets)) c.secrets = {};
  if (!c.env || typeof c.env !== "object") c.env = {};

  for (const name of c.generate) {
    if (typeof name !== "string" || !isValidEnvVar(name)) {
      throw new Error(`heizen.env.yaml: generate entry "${name}" must be UPPER_SNAKE_CASE`);
    }
  }
  for (const key of Object.keys(c.secrets)) {
    if (!isValidEnvVar(key)) {
      throw new Error(`heizen.env.yaml: secrets key "${key}" must be UPPER_SNAKE_CASE`);
    }
  }

  return c as HeizenEnvConfig;
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

export function pulumiKeyFromEnvVar(envVar: string): string {
  return envVar
    .toLowerCase()
    .split("_")
    .map((part, i) => i === 0 ? part : part[0].toUpperCase() + part.slice(1))
    .join("");
}
