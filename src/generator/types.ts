import type { ServiceConfig } from "../schema/types.js";
import type { ECS_DEFAULTS } from "../schema/presets.js";

// One env var that comes from Pulumi config (config.requireSecret).
export interface ConfigVar {
  envVar: string;   // UPPER_SNAKE_CASE (the runtime env var name)
  configVar: string; // camelCase (the Pulumi config key + the exported binding name)
}

export interface ServiceCtx extends ServiceConfig {
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
  // Infrastructure outputs auto-injected into this service's environment.
  envFromDb: boolean;
  envFromRedis: boolean;
  envFromBucket: boolean;
  envFromRegion: boolean;
  envFromNodeEnv: boolean;
  // User-defined env vars, all read from Pulumi config.
  configVars: ConfigVar[];
  // Pulumi rendering helpers — sources passed to pulumi.all([...]) and the
  // matching destructured names used inside the .apply() callback.
  pulumiAllSources: string[];
  pulumiDestructure: string[];
}

export interface NetworkingCtx {
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
}

export interface DatabaseCtx {
  instanceClass: string;
  engineVersion: string;
  allocatedStorage: number;
  storageType: string;
  backupRetentionPeriod: number;
  deletionProtection: boolean;
  encrypted: boolean;
  dbName: string;
  dbPasswordConfigVar: string;
}

export interface CacheCtx {
  nodeType: string;
  engineVersion: string;
}

export interface WildcardRule {
  name: string;
  wildcardTargetGroupVar: string;
  priority: number;
}

export interface TemplateContext {
  project: string;
  env: string;
  prefix: string;
  region: string;
  domain: string;
  ecrImage: string;
  ecrTag: string;
  fullImage: string;

  networking: NetworkingCtx;

  hasDatabase: boolean;
  hasCache: boolean;
  hasStorage: boolean;
  hasAlb: boolean;
  needsRdsSg: boolean;
  needsRedisSg: boolean;

  database?: DatabaseCtx;
  cache?: CacheCtx;

  // All Pulumi config keys store.ts exports (dbPassword + every user env var).
  configExports: ConfigVar[];
  hasConfigExports: boolean;

  services: ServiceCtx[];
  servicesWithDomain: ServiceCtx[];
  servicesWithDomainSorted: ServiceCtx[];
  defaultTargetGroupVar: string;
  ecsDefaults: typeof ECS_DEFAULTS;
  wildcardRules: WildcardRule[];
}
