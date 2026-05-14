import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";
import ora from "ora";

import type { HeizenConfig, HeizenEnvConfig, ServiceConfig, SecretSpec } from "../schema/types.js";
import {
  CPU_PRESETS, DB_PRESETS, CACHE_PRESETS,
  NETWORKING_DEFAULTS, DATABASE_DEFAULTS, CACHE_DEFAULTS, ECS_DEFAULTS,
} from "../schema/presets.js";
import { success } from "../ui.js";

const here = dirname(fileURLToPath(import.meta.url));

registerHelpers();

interface ServiceCtx extends ServiceConfig {
  cpuValue: string;
  memoryValue: string;
  cpuLabel: string;
  hasDomain: boolean;
  targetGroupVar?: string;
  wildcardTargetGroupVar?: string;
  isBackend: boolean;
  isFrontend: boolean;
  isWorker: boolean;
  receivesBackendEnv: boolean;
  scalable: boolean;
  environment: Array<{ name: string; value: string | { ref: "dbUrl" | "redisUrl" | "bucket" | "region" | "nodeEnv" } }>;
  envLiteral: Array<{ name: string; value: string }>;
  envFromDb: boolean;
  envFromRedis: boolean;
  envFromBucket: boolean;
  envFromRegion: boolean;
  envFromNodeEnv: boolean;
  secrets: Array<{ envVar: string; secretName: string; varName: string }>;
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
    dbPasswordSecretVar: string;
    dbPasswordSecretName: string;
  };

  cache?: {
    nodeType: string;
    engineVersion: string;
  };

  allSecrets: Array<{ envVar: string; secretName: string; varName: string }>;
  hasAnySecrets: boolean;

  services: ServiceCtx[];
  servicesWithDomain: ServiceCtx[];
  servicesWithDomainSorted: ServiceCtx[];
  defaultTargetGroupVar: string;
  ecsDefaults: typeof ECS_DEFAULTS;
  wildcardRules: Array<{ name: string; wildcardTargetGroupVar: string; priority: number }>;
}

export async function generateInfra(
  cfg: HeizenConfig,
  envCfg: HeizenEnvConfig,
  cwd: string,
): Promise<void> {
  const spinner = ora("Rendering templates...").start();
  const infraDir = resolve(cwd, "infra");
  const componentsDir = join(infraDir, "components");
  mkdirSync(componentsDir, { recursive: true });

  const ctx = buildTemplateContext(cfg, envCfg);

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

function buildTemplateContext(cfg: HeizenConfig, envCfg: HeizenEnvConfig): TemplateContext {
  const prefix = `${cfg.project}-${cfg.env}`;
  const hasDatabase = cfg.database.engine === "postgres";
  const hasCache = cfg.cache.engine === "redis";
  const hasStorage = cfg.storage.enabled;

  const allSecretSpecs: Array<{ spec: SecretSpec; kind: "generated" | "manual" }> = [
    ...envCfg.secrets.generated.map((spec) => ({ spec, kind: "generated" as const })),
    ...envCfg.secrets.manual.map((spec) => ({ spec, kind: "manual" as const })),
  ];

  const dbPasswordSpec = envCfg.secrets.generated.find((s) => s.name === "db-password");
  const dbPasswordSecretName = dbPasswordSpec ? `${prefix}/${dbPasswordSpec.name}` : `${prefix}/db-password`;
  const dbPasswordSecretVar = "dbPasswordSecret";

  const allSecrets = allSecretSpecs.map(({ spec }) => ({
    envVar: spec.envVar,
    secretName: `${prefix}/${spec.name}`,
    varName: secretVarName(spec.name),
  }));

  const services: ServiceCtx[] = cfg.services.map((s) => {
    const preset = CPU_PRESETS[s.cpu];
    const isBackend = s.type === "backend";
    const isFrontend = s.type === "frontend";
    const isWorker = s.type === "worker";
    const hasDomain = !!s.domain;
    const tgVar = hasDomain ? `${camelize(s.name)}Tg` : undefined;
    const wildcardTgVar = (isFrontend && s.wildcard) ? `${camelize(s.name)}WildcardTg` : undefined;
    const receivesBackendEnv = isBackend || isWorker;
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
      receivesBackendEnv,
      scalable: s.scaling.max > s.scaling.min,
      environment: [],
      envLiteral: [],
      envFromDb: false,
      envFromRedis: false,
      envFromBucket: false,
      envFromRegion: false,
      envFromNodeEnv: false,
      secrets: [],
    };
  });

  const byName = new Map(services.map((s) => [s.name, s]));

  for (const svc of services) {
    populateServiceEnv(svc, cfg, envCfg, hasDatabase, hasCache, hasStorage, byName);
    populateServiceSecrets(svc, envCfg, prefix, byName);
  }

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
      dbPasswordSecretVar,
      dbPasswordSecretName,
    } : undefined,

    cache: hasCache ? {
      nodeType: CACHE_PRESETS[cfg.cache.size].nodeType,
      engineVersion: CACHE_DEFAULTS.engineVersion,
    } : undefined,

    allSecrets,
    hasAnySecrets: allSecrets.length > 0,

    services,
    servicesWithDomain,
    servicesWithDomainSorted,
    defaultTargetGroupVar,
    ecsDefaults: ECS_DEFAULTS,
    wildcardRules,
  };
}

function populateServiceEnv(
  svc: ServiceCtx,
  cfg: HeizenConfig,
  envCfg: HeizenEnvConfig,
  hasDatabase: boolean,
  hasCache: boolean,
  hasStorage: boolean,
  byName: Map<string, ServiceCtx>,
): void {
  const literals: Record<string, string> = {};

  if (svc.receivesBackendEnv) {
    svc.envFromNodeEnv = true;
    if (hasDatabase) svc.envFromDb = true;
    if (hasCache) svc.envFromRedis = true;
    if (hasStorage) {
      svc.envFromBucket = true;
      svc.envFromRegion = true;
    }
    Object.assign(literals, envCfg.env.shared ?? {});
  }

  if (svc.inheritEnvFrom) {
    const parent = byName.get(svc.inheritEnvFrom);
    if (parent) {
      svc.envFromNodeEnv = svc.envFromNodeEnv || parent.envFromNodeEnv;
      svc.envFromDb = svc.envFromDb || parent.envFromDb;
      svc.envFromRedis = svc.envFromRedis || parent.envFromRedis;
      svc.envFromBucket = svc.envFromBucket || parent.envFromBucket;
      svc.envFromRegion = svc.envFromRegion || parent.envFromRegion;
      for (const lit of parent.envLiteral) {
        if (!(lit.name in literals)) literals[lit.name] = lit.value;
      }
    }
  }

  const own = envCfg.env[svc.name];
  if (own) Object.assign(literals, own);

  svc.envLiteral = Object.entries(literals).map(([name, value]) => ({ name, value }));
}

function populateServiceSecrets(
  svc: ServiceCtx,
  envCfg: HeizenEnvConfig,
  prefix: string,
  byName: Map<string, ServiceCtx>,
): void {
  const collected = new Map<string, { envVar: string; secretName: string; varName: string }>();
  const all = [...envCfg.secrets.generated, ...envCfg.secrets.manual];

  for (const spec of all) {
    if (spec.services.includes(svc.name)) {
      collected.set(spec.envVar, {
        envVar: spec.envVar,
        secretName: `${prefix}/${spec.name}`,
        varName: secretVarName(spec.name),
      });
    }
  }

  if (svc.inheritEnvFrom) {
    const parent = byName.get(svc.inheritEnvFrom);
    if (parent) {
      for (const s of parent.secrets) {
        if (!collected.has(s.envVar)) collected.set(s.envVar, s);
      }
    }
  }

  svc.secrets = Array.from(collected.values());
}

function secretVarName(secretName: string): string {
  return camelize(secretName) + "Secret";
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
  if (!templatePath) throw new Error(`Template not found: ${name}.hbs`);
  const src = readFileSync(templatePath, "utf8");
  const tpl = Handlebars.compile(src, { noEscape: true });
  return tpl(ctx);
}

function registerHelpers(): void {
  Handlebars.registerHelper("camel", (s: string) => camelize(s));
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper("priority", (index: number) => (index + 1) * 100);
  Handlebars.registerHelper("jsonString", (v: unknown) => JSON.stringify(v));
  Handlebars.registerHelper("dbUrl", function (this: any) {
    return "`postgresql://postgres:${dbPass}@${dbEndpoint}/" + this.database.dbName + "`";
  });
}

function camelize(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}
