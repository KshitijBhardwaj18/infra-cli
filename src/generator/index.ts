import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import ora from "ora";

import type { HeizenConfig, ServiceConfig } from "../schema/types.js";
import {
  CPU_PRESETS, DB_PRESETS, CACHE_PRESETS, NAT_PRESETS,
  NETWORKING_DEFAULTS, DATABASE_DEFAULTS, CACHE_DEFAULTS, ECS_DEFAULTS,
} from "../schema/presets.js";
import { success } from "../ui.js";

const here = dirname(fileURLToPath(import.meta.url));

registerHelpers();

export async function generateInfra(cfg: HeizenConfig, cwd: string): Promise<void> {
  const spinner = ora("Generating infrastructure code...").start();
  const infraDir = resolve(cwd, "infra");
  const componentsDir = join(infraDir, "components");
  mkdirSync(componentsDir, { recursive: true });

  const ctx = buildTemplateContext(cfg);

  const files: Array<[string, string]> = [
    ["pulumi-yaml", join(infraDir, "Pulumi.yaml")],
    ["pulumi-stack-yaml", join(infraDir, `Pulumi.${cfg.env}.yaml`)],
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

  spinner.stop();

  for (const [templateName, outPath] of files) {
    const rendered = renderTemplate(templateName, ctx);
    writeFileSync(outPath, rendered, "utf8");
    const rel = outPath.replace(cwd + "/", "");
    success(`Generated: ${rel}`);
  }
}

interface ComputeServiceCtx extends ServiceConfig {
  cpuValue: string;
  memoryValue: string;
  cpuLabel: string;
  hasDomain: boolean;
  targetGroupVar?: string;
  wildcardTargetGroupVar?: string;
  isBackend: boolean;
  isFrontend: boolean;
  isWorker: boolean;
  needsTaskRole: boolean;
  scalable: boolean;
}

interface TemplateContext {
  project: string;
  env: string;
  prefix: string;
  region: string;
  rootDomain: string;
  domain: string;
  ecrImage: string;
  ecrTag: string;
  fullImage: string;

  networking: {
    vpcCidr: string;
    publicSubnet1Cidr: string;
    publicSubnet2Cidr: string;
    privateSubnet1Cidr: string;
    privateSubnet2Cidr: string;
    az1Suffix: string;
    az2Suffix: string;
    nat: "single" | "dual";
    natIsDual: boolean;
    ecsPortRangeFrom: number;
    ecsPortRangeTo: number;
  };

  hasDatabase: boolean;
  hasCache: boolean;
  hasStorage: boolean;
  hasSmtp: boolean;
  hasAlb: boolean;
  needsRdsSg: boolean;
  needsRedisSg: boolean;

  database?: {
    instanceClass: string;
    engineVersion: string;
    allocatedStorage: number;
    storageType: string;
    backupRetentionPeriod: number;
    deletionProtection: boolean;
    encrypted: boolean;
    dbName: string;
  };

  cache?: {
    nodeType: string;
    engineVersion: string;
  };

  smtp?: {
    host: string;
    port: string;
    from: string;
    fromName: string;
  };

  services: ComputeServiceCtx[];
  servicesWithDomain: ComputeServiceCtx[];
  servicesWithDomainSorted: ComputeServiceCtx[];
  defaultTargetGroupVar: string;

  ecsDefaults: typeof ECS_DEFAULTS;

  serviceDomainExports: Array<{ name: string; varName: string; constName: string; domain: string }>;
  containsBackendOrWorker: boolean;
  wildcardRules: Array<{ name: string; wildcardTargetGroupVar: string; priority: number }>;
}

function buildTemplateContext(cfg: HeizenConfig): TemplateContext {
  const prefix = `${cfg.project}-${cfg.env}`;
  const hasDatabase = cfg.database.engine === "postgres";
  const hasCache = cfg.cache.engine === "redis";
  const hasStorage = cfg.storage.enabled;
  const hasSmtp = !!cfg.smtp;

  const services: ComputeServiceCtx[] = cfg.services.map((s) => {
    const preset = CPU_PRESETS[s.cpu];
    const isBackend = s.type === "backend";
    const isFrontend = s.type === "frontend";
    const isWorker = s.type === "worker";
    const hasDomain = !!s.domain;
    const tgVar = hasDomain ? `${camelize(s.name)}Tg` : undefined;
    const wildcardTgVar = (isFrontend && s.wildcard) ? `${camelize(s.name)}WildcardTg` : undefined;
    return {
      ...s,
      cpuValue: preset.cpu,
      memoryValue: preset.memory,
      cpuLabel: preset.label,
      hasDomain,
      targetGroupVar: tgVar,
      wildcardTargetGroupVar: wildcardTgVar,
      isBackend,
      isFrontend,
      isWorker,
      needsTaskRole: isBackend || isWorker,
      scalable: s.scaling.max > s.scaling.min,
    };
  });

  const servicesWithDomain = services.filter((s) => s.hasDomain);
  const servicesWithDomainSorted = [...servicesWithDomain].sort((a, b) => {
    if (a.wildcard && !b.wildcard) return 1;
    if (!a.wildcard && b.wildcard) return -1;
    return 0;
  });
  const hasAlb = servicesWithDomain.length > 0;

  const wildcardRules: Array<{ name: string; wildcardTargetGroupVar: string; priority: number }> = [];
  let wildcardPriority = (servicesWithDomain.length + 1) * 100;
  for (const s of services) {
    if (s.isFrontend && s.wildcard && s.wildcardTargetGroupVar) {
      wildcardRules.push({
        name: s.name,
        wildcardTargetGroupVar: s.wildcardTargetGroupVar,
        priority: wildcardPriority,
      });
      wildcardPriority += 100;
    }
  }

  const defaultDomainService = servicesWithDomain.find((s) => s.isFrontend) ?? servicesWithDomain[0];
  const defaultTargetGroupVar = defaultDomainService?.targetGroupVar ?? "";

  const allServicePorts = services
    .flatMap((s) => [s.port, s.wildcardPort].filter((p): p is number => typeof p === "number"));
  const ecsPortRangeFrom = allServicePorts.length ? Math.min(...allServicePorts) : 3000;
  const ecsPortRangeTo = allServicePorts.length ? Math.max(...allServicePorts) : 3000;

  return {
    project: cfg.project,
    env: cfg.env,
    prefix,
    region: cfg.region,
    rootDomain: cfg.domain,
    domain: cfg.domain,
    ecrImage: cfg.ecr.image,
    ecrTag: cfg.ecr.tag,
    fullImage: `${cfg.ecr.image}:${cfg.ecr.tag}`,

    networking: {
      vpcCidr: cfg.networking.vpcCidr ?? NETWORKING_DEFAULTS.vpcCidr,
      publicSubnet1Cidr: cfg.networking.publicSubnet1Cidr ?? NETWORKING_DEFAULTS.publicSubnet1Cidr,
      publicSubnet2Cidr: cfg.networking.publicSubnet2Cidr ?? NETWORKING_DEFAULTS.publicSubnet2Cidr,
      privateSubnet1Cidr: cfg.networking.privateSubnet1Cidr ?? NETWORKING_DEFAULTS.privateSubnet1Cidr,
      privateSubnet2Cidr: cfg.networking.privateSubnet2Cidr ?? NETWORKING_DEFAULTS.privateSubnet2Cidr,
      az1Suffix: NETWORKING_DEFAULTS.az1Suffix,
      az2Suffix: NETWORKING_DEFAULTS.az2Suffix,
      nat: cfg.networking.nat,
      natIsDual: cfg.networking.nat === "dual",
      ecsPortRangeFrom,
      ecsPortRangeTo,
    },

    hasDatabase,
    hasCache,
    hasStorage,
    hasSmtp,
    hasAlb,
    needsRdsSg: hasDatabase,
    needsRedisSg: hasCache,

    database: hasDatabase ? {
      instanceClass: DB_PRESETS[cfg.database.size].instanceClass,
      engineVersion: DATABASE_DEFAULTS.engineVersion,
      allocatedStorage: DATABASE_DEFAULTS.allocatedStorage,
      storageType: DATABASE_DEFAULTS.storageType,
      backupRetentionPeriod: DATABASE_DEFAULTS.backupRetentionPeriod,
      deletionProtection: cfg.database.deletionProtection,
      encrypted: DATABASE_DEFAULTS.encrypted,
      dbName: cfg.project.replace(/-/g, "_"),
    } : undefined,

    cache: hasCache ? {
      nodeType: CACHE_PRESETS[cfg.cache.size].nodeType,
      engineVersion: CACHE_DEFAULTS.engineVersion,
    } : undefined,

    smtp: cfg.smtp,

    services,
    servicesWithDomain,
    servicesWithDomainSorted,
    defaultTargetGroupVar,
    ecsDefaults: ECS_DEFAULTS,

    serviceDomainExports: services.map((s) => ({
      name: s.name,
      varName: `${camelize(s.name)}Service`,
      constName: `${camelize(s.name)}ServiceName`,
      domain: s.domain ?? "",
    })),
    containsBackendOrWorker: services.some((s) => s.isBackend || s.isWorker),
    wildcardRules,
  };
}

function renderTemplate(name: string, ctx: TemplateContext): string {
  const candidates = [
    join(here, "templates", `${name}.hbs`),
    join(here, "..", "..", "src", "generator", "templates", `${name}.hbs`),
  ];
  let templatePath = "";
  for (const c of candidates) {
    if (existsSync(c)) { templatePath = c; break; }
  }
  if (!templatePath) {
    throw new Error(`Template not found: ${name}.hbs`);
  }
  const src = readFileSync(templatePath, "utf8");
  const tpl = Handlebars.compile(src, { noEscape: true });
  return tpl(ctx);
}

function registerHelpers(): void {
  Handlebars.registerHelper("camel", (s: string) => camelize(s));
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper("priority", (index: number) => (index + 1) * 100);
  Handlebars.registerHelper("upperConst", (s: string) =>
    s.replace(/-/g, "_").toUpperCase()
  );
  Handlebars.registerHelper("jsonString", (v: unknown) => JSON.stringify(v));
}

function camelize(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
