export type CpuSize = "small" | "medium" | "large";
export type DbSize = "small" | "medium" | "large";
export type CacheSize = "small" | "medium";
export type NatMode = "single" | "dual";
export type ServiceType = "backend" | "frontend" | "worker";

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
  };
  cache: {
    engine: "redis" | "none";
    size: CacheSize;
  };
  storage: {
    enabled: boolean;
  };
}

export type SecretKind = "generated" | "manual";

export interface SecretSpec {
  name: string;
  envVar: string;
  services: string[];
}

export interface HeizenEnvConfig {
  awsProfile: string;
  secrets: {
    generated: SecretSpec[];
    manual: SecretSpec[];
  };
  env: {
    shared?: Record<string, string>;
    [serviceName: string]: Record<string, string> | undefined;
  };
}
