export type CpuSize = "small" | "medium" | "large";
export type DbSize = "small" | "medium" | "large";
export type CacheSize = "small" | "medium";
export type NatMode = "single" | "dual";
export type ServiceType = "backend" | "frontend" | "worker";

export const AUTO_VALUE = "auto";

export interface ServiceConfig {
  name: string;
  type: ServiceType;
  port?: number;
  domain?: string;
  wildcard?: boolean;
  wildcardPort?: number;
  cpu: CpuSize;
  scaling: {
    min: number;
    max: number;
    cpuTarget: number;
  };
  command: string;
  healthCheck?: {
    path: string;
    codes: string;
  };
  inheritEnvFrom?: string;
}

export interface HeizenConfig {
  version: 1;
  project: string;
  env: string;
  region: string;
  domain: string;
  ecr: {
    image: string;
    tag: string;
  };
  networking: {
    nat: NatMode;
    vpcCidr?: string;
    publicSubnet1Cidr?: string;
    publicSubnet2Cidr?: string;
    privateSubnet1Cidr?: string;
    privateSubnet2Cidr?: string;
  };
  services: ServiceConfig[];
  database: {
    engine: "postgres" | "none";
    size: DbSize;
    deletionProtection: boolean;
    dbName?: string;
  };
  cache: {
    engine: "redis" | "none";
    size: CacheSize;
  };
  storage: {
    enabled: boolean;
  };
}

// All env vars live here. A value of AUTO_VALUE ("auto") means
// "generate a random hex secret on first deploy". Any other string is the
// literal value. All values are stored encrypted in Pulumi config.
export interface HeizenEnvConfig {
  awsProfile: string;
  env: {
    shared?: Record<string, string>;
    [serviceName: string]: Record<string, string> | undefined;
  };
}
