import type { HeizenConfig, HeizenEnvConfig, ServiceConfig } from "../schema/types.js";
import {
  CPU_PRESETS, DB_PRESETS, CACHE_PRESETS,
  NETWORKING_DEFAULTS, DATABASE_DEFAULTS, CACHE_DEFAULTS, ECS_DEFAULTS,
} from "../schema/presets.js";
import { envVarToCamelCase } from "../schema/validator.js";
import { camelize } from "./render.js";
import type { ConfigVar, ServiceCtx, TemplateContext, WildcardRule } from "./types.js";

const DB_PASSWORD_CONFIG_VAR = "dbPassword";
const WILDCARD_PRIORITY_STEP = 100;
const DEFAULT_PORT = 3000;

export function buildTemplateContext(cfg: HeizenConfig, envCfg: HeizenEnvConfig): TemplateContext {
  const prefix = `${cfg.project}-${cfg.env}`;
  const hasDatabase = cfg.database.engine === "postgres";
  const hasCache = cfg.cache.engine === "redis";
  const hasStorage = cfg.storage.enabled;
  const dbName = cfg.database.dbName ?? cfg.project.replace(/-/g, "_");

  const services = cfg.services.map((s) => buildBaseServiceCtx(s));
  const byName = new Map(services.map((s) => [s.name, s]));

  for (const svc of services) {
    svc.configVars = resolveConfigVars(svc, envCfg, byName);
    setAutoInjectedFlags(svc, hasDatabase, hasCache, hasStorage);
    const { sources, destructure } = buildPulumiAllSources(svc);
    svc.pulumiAllSources = sources;
    svc.pulumiDestructure = destructure;
  }

  const configExports = collectConfigExports(services, hasDatabase);
  const servicesWithDomain = services.filter((s) => s.hasDomain);
  const servicesWithDomainSorted = sortDomainsByWildcard(servicesWithDomain);
  const wildcardRules = buildWildcardRules(services, servicesWithDomain.length);
  const defaultTargetGroupVar = pickDefaultTargetGroupVar(servicesWithDomain);
  const { ecsPortRangeFrom, ecsPortRangeTo } = computeEcsPortRange(services);

  return {
    project: cfg.project,
    env: cfg.env,
    prefix,
    region: cfg.region,
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
    hasAlb: servicesWithDomain.length > 0,
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
      dbName,
      dbPasswordConfigVar: DB_PASSWORD_CONFIG_VAR,
    } : undefined,

    cache: hasCache ? {
      nodeType: CACHE_PRESETS[cfg.cache.size].nodeType,
      engineVersion: CACHE_DEFAULTS.engineVersion,
    } : undefined,

    configExports,
    hasConfigExports: configExports.length > 0,

    services,
    servicesWithDomain,
    servicesWithDomainSorted,
    defaultTargetGroupVar,
    ecsDefaults: ECS_DEFAULTS,
    wildcardRules,
  };
}

function buildBaseServiceCtx(s: ServiceConfig): ServiceCtx {
  const preset = CPU_PRESETS[s.cpu];
  const isBackend = s.type === "backend";
  const isFrontend = s.type === "frontend";
  const isWorker = s.type === "worker";
  const hasDomain = !!s.domain;
  return {
    ...s,
    cpuValue: preset.cpu,
    memoryValue: preset.memory,
    cpuLabel: preset.label,
    hasDomain,
    targetGroupVar: hasDomain ? `${camelize(s.name)}Tg` : undefined,
    wildcardTargetGroupVar: (isFrontend && s.wildcard) ? `${camelize(s.name)}WildcardTg` : undefined,
    isBackend,
    isFrontend,
    isWorker,
    receivesBackendEnv: isBackend || isWorker,
    scalable: s.scaling.max > s.scaling.min,
    envFromDb: false,
    envFromRedis: false,
    envFromBucket: false,
    envFromRegion: false,
    envFromNodeEnv: false,
    configVars: [],
    pulumiAllSources: [],
    pulumiDestructure: [],
  };
}

// All services get env.shared vars plus their own per-service vars.
// Backends/workers additionally get auto-injected infrastructure vars
// (DATABASE_URL, REDIS_URL, S3, NODE_ENV) via setAutoInjectedFlags().
// inheritEnvFrom merges a parent service's config vars.
// Duplicates resolved by first-write-wins.
function resolveConfigVars(
  svc: ServiceCtx,
  envCfg: HeizenEnvConfig,
  byName: Map<string, ServiceCtx>,
): ConfigVar[] {
  const order: string[] = [];
  const seen = new Set<string>();

  const add = (vars: Record<string, string> | undefined): void => {
    if (!vars) return;
    for (const envVar of Object.keys(vars)) {
      if (seen.has(envVar)) continue;
      seen.add(envVar);
      order.push(envVar);
    }
  };

  add(envCfg.env.shared);
  if (svc.inheritEnvFrom) {
    const parent = byName.get(svc.inheritEnvFrom);
    if (parent) {
      for (const v of parent.configVars) {
        if (seen.has(v.envVar)) continue;
        seen.add(v.envVar);
        order.push(v.envVar);
      }
    }
  }
  add(envCfg.env[svc.name]);

  return order.map((envVar) => ({ envVar, configVar: envVarToCamelCase(envVar) }));
}

function setAutoInjectedFlags(
  svc: ServiceCtx,
  hasDatabase: boolean,
  hasCache: boolean,
  hasStorage: boolean,
): void {
  if (!svc.receivesBackendEnv) return;
  svc.envFromNodeEnv = true;
  svc.envFromDb = hasDatabase;
  svc.envFromRedis = hasCache;
  svc.envFromBucket = hasStorage;
  svc.envFromRegion = hasStorage;
}

function buildPulumiAllSources(svc: ServiceCtx): { sources: string[]; destructure: string[] } {
  const sources: string[] = [];
  const destructure: string[] = [];

  if (svc.envFromDb) {
    sources.push("db.endpoint");
    destructure.push("dbEndpoint");
    sources.push(DB_PASSWORD_CONFIG_VAR);
    destructure.push("dbPass");
  }
  if (svc.envFromRedis) {
    sources.push("redis.cacheNodes.apply((nodes: any) => nodes[0].address)");
    destructure.push("rHost");
    sources.push("redis.cacheNodes.apply((nodes: any) => nodes[0].port.toString())");
    destructure.push("rPort");
  }
  if (svc.envFromBucket) {
    sources.push("bucket.bucket");
    destructure.push("bucketName");
  }
  for (const cv of svc.configVars) {
    sources.push(cv.configVar);
    destructure.push(`${cv.configVar}Val`);
  }
  return { sources, destructure };
}

function collectConfigExports(services: ServiceCtx[], hasDatabase: boolean): ConfigVar[] {
  const seen = new Set<string>();
  const out: ConfigVar[] = [];
  if (hasDatabase) {
    out.push({ envVar: "DATABASE_PASSWORD", configVar: DB_PASSWORD_CONFIG_VAR });
    seen.add(DB_PASSWORD_CONFIG_VAR);
  }
  for (const svc of services) {
    for (const cv of svc.configVars) {
      if (seen.has(cv.configVar)) continue;
      seen.add(cv.configVar);
      out.push(cv);
    }
  }
  return out;
}

function sortDomainsByWildcard(domains: ServiceCtx[]): ServiceCtx[] {
  return [...domains].sort((a, b) => Number(!!a.wildcard) - Number(!!b.wildcard));
}

function buildWildcardRules(services: ServiceCtx[], domainCount: number): WildcardRule[] {
  const rules: WildcardRule[] = [];
  let priority = (domainCount + 1) * WILDCARD_PRIORITY_STEP;
  for (const s of services) {
    if (s.isFrontend && s.wildcard && s.wildcardTargetGroupVar) {
      rules.push({ name: s.name, wildcardTargetGroupVar: s.wildcardTargetGroupVar, priority });
      priority += WILDCARD_PRIORITY_STEP;
    }
  }
  return rules;
}

function pickDefaultTargetGroupVar(domains: ServiceCtx[]): string {
  const defaultDomainService = domains.find((s) => s.isFrontend) ?? domains[0];
  return defaultDomainService?.targetGroupVar ?? "";
}

function computeEcsPortRange(services: ServiceCtx[]): { ecsPortRangeFrom: number; ecsPortRangeTo: number } {
  const ports = services.flatMap((s) => [s.port, s.wildcardPort].filter((p): p is number => typeof p === "number"));
  if (ports.length === 0) return { ecsPortRangeFrom: DEFAULT_PORT, ecsPortRangeTo: DEFAULT_PORT };
  return { ecsPortRangeFrom: Math.min(...ports), ecsPortRangeTo: Math.max(...ports) };
}
