export const CPU_PRESETS = {
    small: { cpu: "256", memory: "512", label: "0.25 vCPU / 512 MB", monthlyCost: 8 },
    medium: { cpu: "512", memory: "1024", label: "0.5 vCPU / 1 GB", monthlyCost: 18 },
    large: { cpu: "1024", memory: "2048", label: "1 vCPU / 2 GB", monthlyCost: 36 },
};
export const DB_PRESETS = {
    small: { instanceClass: "db.t4g.small", label: "2 vCPU / 2 GB RAM", monthlyCost: 15 },
    medium: { instanceClass: "db.t4g.medium", label: "2 vCPU / 4 GB RAM", monthlyCost: 30 },
    large: { instanceClass: "db.t4g.large", label: "2 vCPU / 8 GB RAM", monthlyCost: 60 },
};
export const CACHE_PRESETS = {
    small: { nodeType: "cache.t4g.small", label: "1.5 GB RAM", monthlyCost: 24 },
    medium: { nodeType: "cache.t4g.medium", label: "3 GB RAM", monthlyCost: 48 },
};
export const NAT_PRESETS = {
    single: { count: 1, label: "1 NAT Gateway (sufficient for most workloads)", monthlyCost: 35 },
    dual: { count: 2, label: "2 NAT Gateways (high availability)", monthlyCost: 70 },
};
export const NETWORKING_DEFAULTS = {
    vpcCidr: "10.0.0.0/16",
    publicSubnet1Cidr: "10.0.1.0/24",
    publicSubnet2Cidr: "10.0.2.0/24",
    privateSubnet1Cidr: "10.0.3.0/24",
    privateSubnet2Cidr: "10.0.4.0/24",
    az1Suffix: "a",
    az2Suffix: "b",
};
export const DATABASE_DEFAULTS = {
    engine: "postgres",
    engineVersion: "16.6",
    allocatedStorage: 20,
    storageType: "gp3",
    backupRetentionPeriod: 7,
    deletionProtection: true,
    encrypted: true,
};
export const CACHE_DEFAULTS = {
    engine: "redis",
    engineVersion: "7.1",
};
export const ECS_DEFAULTS = {
    healthCheckInterval: 30,
    healthCheckTimeout: 5,
    healthyThreshold: 3,
    unhealthyThreshold: 2,
    healthCheckCodes: "200-499",
    autoScaleCpuTarget: 70,
    logRetentionDays: 90,
    containerInsights: true,
    circuitBreaker: true,
    ecsExec: true,
};
export const STORAGE_DEFAULTS = {
    versioning: true,
    encryption: "AES-256",
    publicAccessBlocked: true,
};
export const REGIONS = [
    "us-east-1",
    "us-west-2",
    "eu-west-1",
    "eu-central-1",
    "ap-south-1",
    "ap-southeast-1",
];
export const ALB_MONTHLY_COST = 18;
export const STORAGE_OVERHEAD_MONTHLY = 10;
//# sourceMappingURL=presets.js.map