import { confirm, input, select } from "@inquirer/prompts";

import { CPU_PRESETS, ECS_DEFAULTS } from "../../../schema/presets.js";
import type { CpuSize, ServiceConfig, ServiceType } from "../../../schema/types.js";
import { isKebabCase, isValidDomain } from "../../../schema/validator.js";
import { box, dim, header, padRight, section } from "../../../ui/index.js";

const MAX_SERVICES = 5;
const SERVICE_TYPE_CHOICES: Array<{ name: ServiceType; value: ServiceType }> = [
  { name: "backend", value: "backend" },
  { name: "frontend", value: "frontend" },
  { name: "worker", value: "worker" },
];

export async function promptServices(): Promise<ServiceConfig[]> {
  section("Services");

  const total = await promptServiceCount();
  const services: ServiceConfig[] = [];
  for (let i = 0; i < total; i++) {
    console.log();
    header(`Configuring service ${i + 1} of ${total}:`);
    console.log();
    services.push(await promptService(services));
  }

  printServiceDefaults();
  await maybeCustomizeDefaults(services);
  return services;
}

async function promptServiceCount(): Promise<number> {
  const raw = await input({
    message: `Number of services (1-${MAX_SERVICES}):`,
    default: "1",
    validate: (v) => {
      const n = Number(v);
      return (Number.isInteger(n) && n >= 1 && n <= MAX_SERVICES) || `Enter an integer between 1 and ${MAX_SERVICES}.`;
    },
  });
  return Number(raw);
}

async function promptService(existing: ServiceConfig[]): Promise<ServiceConfig> {
  const name = await promptServiceName(existing);
  const type = (await select({ message: "Service type:", choices: SERVICE_TYPE_CHOICES })) as ServiceType;

  switch (type) {
    case "backend": return await promptBackend(name);
    case "frontend": return await promptFrontend(name);
    case "worker": return await promptWorker(name, existing);
  }
}

async function promptServiceName(existing: ServiceConfig[]): Promise<string> {
  return await input({
    message: "Service name (kebab-case):",
    validate: (v) => {
      if (!isKebabCase(v)) return "Must be kebab-case.";
      if (existing.some((s) => s.name === v)) return "Service names must be unique.";
      return true;
    },
  });
}

async function promptCpu(): Promise<CpuSize> {
  const choices = (Object.keys(CPU_PRESETS) as CpuSize[]).map((k) => ({
    name: `${padRight(k, 7)}- ${CPU_PRESETS[k].label}  (~$${CPU_PRESETS[k].monthlyCost}/mo per replica)`,
    value: k,
  }));
  return (await select({ message: "CPU:", choices })) as CpuSize;
}

async function promptCommand(): Promise<string> {
  return await input({
    message: "Start command:",
    validate: (v) => v.length > 0 || "Command is required.",
  });
}

async function promptDomain(example: string): Promise<string> {
  return await input({
    message: `Domain (e.g., ${example}):`,
    validate: (v) => isValidDomain(v) || "Enter a valid domain.",
  });
}

async function promptReplicas(minDefault: string, maxDefault: string): Promise<{ min: number; max: number }> {
  const min = Number(await input({ message: "Minimum replicas:", default: minDefault }));
  const max = Number(await input({ message: "Maximum replicas:", default: maxDefault }));
  return { min, max };
}

async function promptBackend(name: string): Promise<ServiceConfig> {
  const port = Number(await input({ message: "Port:", default: "3001" }));
  const domain = await promptDomain("api.myapp.com");
  const cpu = await promptCpu();
  const { min, max } = await promptReplicas("2", "10");
  const command = await promptCommand();
  const healthPath = await input({ message: "Health check path:", default: "/api" });
  return {
    name, type: "backend", port, domain, cpu,
    scaling: { min, max, cpuTarget: ECS_DEFAULTS.autoScaleCpuTarget },
    command,
    healthCheck: { path: healthPath, codes: ECS_DEFAULTS.healthCheckCodes },
  };
}

async function promptFrontend(name: string): Promise<ServiceConfig> {
  const port = Number(await input({ message: "Port:", default: "3000" }));
  const domain = await promptDomain("app.myapp.com");
  const wildcard = await confirm({
    message: "Wildcard subdomains? (e.g., tenant.myapp.com)",
    default: false,
  });
  const wildcardPort = wildcard
    ? Number(await input({ message: "Wildcard port:", default: "3002" }))
    : undefined;
  const cpu = await promptCpu();
  const { min, max } = await promptReplicas("1", "3");
  const command = await promptCommand();
  const healthPath = await input({ message: "Health check path:", default: "/" });
  return {
    name, type: "frontend", port, domain, wildcard, wildcardPort, cpu,
    scaling: { min, max, cpuTarget: ECS_DEFAULTS.autoScaleCpuTarget },
    command,
    healthCheck: { path: healthPath, codes: ECS_DEFAULTS.healthCheckCodes },
  };
}

async function promptWorker(name: string, existing: ServiceConfig[]): Promise<ServiceConfig> {
  const cpu = await promptCpu();
  const { min, max } = await promptReplicas("1", "1");
  const command = await promptCommand();
  const inheritChoices = [
    { name: "none", value: "" },
    ...existing.filter((s) => s.type !== "worker").map((s) => ({ name: s.name, value: s.name })),
  ];
  const inheritEnvFrom = await select({
    message: "Inherit environment from:",
    choices: inheritChoices,
    default: "",
  });
  return {
    name, type: "worker", cpu,
    scaling: { min, max, cpuTarget: ECS_DEFAULTS.autoScaleCpuTarget },
    command,
    inheritEnvFrom: inheritEnvFrom || undefined,
  };
}

function printServiceDefaults(): void {
  console.log();
  dim("Service defaults applied:");
  box([
    `Health check interval:    ${ECS_DEFAULTS.healthCheckInterval}s`,
    `Health check timeout:     ${ECS_DEFAULTS.healthCheckTimeout}s`,
    `Healthy threshold:        ${ECS_DEFAULTS.healthyThreshold} checks`,
    `Unhealthy threshold:      ${ECS_DEFAULTS.unhealthyThreshold} checks`,
    `Health check codes:       ${ECS_DEFAULTS.healthCheckCodes}`,
    `Auto-scaling target:      ${ECS_DEFAULTS.autoScaleCpuTarget}% CPU`,
    `Circuit breaker:          enabled (auto-rollback)`,
    `ECS Exec:                 enabled`,
  ]);
  console.log();
}

async function maybeCustomizeDefaults(services: ServiceConfig[]): Promise<void> {
  const customize = await confirm({ message: "Customize service defaults?", default: false });
  if (!customize) return;
  dim("Override any setting per service. Press enter to keep the default.");
  for (const svc of services) {
    console.log();
    header(`Service: ${svc.name}`);
    svc.scaling.cpuTarget = Number(await input({
      message: "Auto-scale CPU target (%):",
      default: String(svc.scaling.cpuTarget),
    }));
    if (svc.healthCheck) {
      svc.healthCheck.codes = await input({
        message: "Health check success codes:",
        default: svc.healthCheck.codes,
      });
    }
  }
}
