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
  env?: Record<string, string>;
  inheritEnvFrom?: string;
}

export interface HeizenConfig {
  version: 1;
  project: string;
  env: string;
  region: string;
  awsProfile: string;
  domain: string;

  ecr: {
    image: string;
    tag: string;
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

  networking: {
    nat: NatMode;
    vpcCidr?: string;
    publicSubnet1Cidr?: string;
    publicSubnet2Cidr?: string;
    privateSubnet1Cidr?: string;
    privateSubnet2Cidr?: string;
  };

  smtp?: {
    host: string;
    port: string;
    from: string;
    fromName: string;
  };
}
