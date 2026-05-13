import { input, select, confirm, password } from "@inquirer/prompts";
import chalk from "chalk";
import yaml from "js-yaml";
import { writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { execa } from "execa";
import ora from "ora";

import {
  CPU_PRESETS, DB_PRESETS, CACHE_PRESETS, NAT_PRESETS,
  NETWORKING_DEFAULTS, DATABASE_DEFAULTS, CACHE_DEFAULTS,
  ECS_DEFAULTS, REGIONS, ALB_MONTHLY_COST, STORAGE_OVERHEAD_MONTHLY,
} from "../schema/presets.js";
import type {
  HeizenConfig, ServiceConfig, CpuSize, DbSize, CacheSize, NatMode, ServiceType,
} from "../schema/types.js";
import { isKebabCase, isValidDomain } from "../schema/validator.js";
import { section, box, success, info, warn, dim, header, nextSteps, padRight } from "../ui.js";
import { generateInfra } from "../generator/index.js";

export async function runInit(): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("Heizen Infra Init"));
  dim("Generates Pulumi infrastructure for AWS ECS Fargate.");

  const project = await promptProject();
  const networking = await promptNetworking(project.region);
  const services = await promptServices();
  const data = await promptDataStores();
  const smtp = await promptSecrets(project.project, project.env);
  const config = buildConfig({ ...project, networking, services, ...data, smtp });

  printSummary(config);

  const proceed = await confirm({
    message: "Generate infrastructure code?",
    default: true,
  });
  if (!proceed) {
    saveYaml(config);
    info("heizen.yaml written. Run 'heizen infra init' again to regenerate.");
    return;
  }

  saveYaml(config);
  await generateInfra(config, process.cwd());
  await installDeps();

  console.log();
  success("Infrastructure code generated.");
  nextSteps([
    "Run 'heizen infra deploy' to provision infrastructure",
    `Push a Docker image to ${config.ecr.image}:${config.ecr.tag}`,
    "Add DNS records (shown after deploy)",
  ]);
}

interface ProjectAnswers {
  project: string;
  env: string;
  region: string;
  awsProfile: string;
  domain: string;
  ecr: { image: string; tag: string };
}

async function promptProject(): Promise<ProjectAnswers> {
  section("Project Configuration");
  dim("Identifying details for the new infrastructure stack.");
  console.log();

  const project = await input({
    message: "Project name (kebab-case, e.g., workforce):",
    validate: (v) => isKebabCase(v) || "Must be kebab-case (lowercase, numbers, dashes).",
  });
  const env = await input({ message: "Environment:", default: "prod" });
  const region = await select({
    message: "AWS region:",
    choices: REGIONS.map((r) => ({ name: r, value: r })),
    default: "us-east-1",
  });
  const awsProfile = await input({ message: "AWS profile:", default: "default" });
  const domain = await input({
    message: "Root domain (e.g., stafflogic.com):",
    validate: (v) => isValidDomain(v) || "Enter a valid domain like example.com.",
  });
  const ecrImage = await input({
    message: "ECR image URI (e.g., 123456.dkr.ecr.us-east-1.amazonaws.com/myapp):",
    validate: (v) => v.includes("dkr.ecr.") || "Provide a full ECR repository URI.",
  });
  const ecrTag = await input({ message: "ECR image tag:", default: "latest" });

  return { project, env, region, awsProfile, domain, ecr: { image: ecrImage, tag: ecrTag } };
}

interface NetworkingAnswers {
  nat: NatMode;
  vpcCidr: string;
  publicSubnet1Cidr: string;
  publicSubnet2Cidr: string;
  privateSubnet1Cidr: string;
  privateSubnet2Cidr: string;
}

async function promptNetworking(region: string): Promise<NetworkingAnswers> {
  section("Networking");

  dim("Using standard networking defaults:");
  console.log();
  box([
    `VPC:               ${NETWORKING_DEFAULTS.vpcCidr} (65,536 IPs)`,
    `Availability Zones: ${region}${NETWORKING_DEFAULTS.az1Suffix}, ${region}${NETWORKING_DEFAULTS.az2Suffix}`,
    "Public Subnets (ALB, NAT):",
    `  ${region}${NETWORKING_DEFAULTS.az1Suffix}: ${NETWORKING_DEFAULTS.publicSubnet1Cidr} (256 IPs)`,
    `  ${region}${NETWORKING_DEFAULTS.az2Suffix}: ${NETWORKING_DEFAULTS.publicSubnet2Cidr} (256 IPs)`,
    "Private Subnets (ECS, RDS, Redis):",
    `  ${region}${NETWORKING_DEFAULTS.az1Suffix}: ${NETWORKING_DEFAULTS.privateSubnet1Cidr} (256 IPs)`,
    `  ${region}${NETWORKING_DEFAULTS.az2Suffix}: ${NETWORKING_DEFAULTS.privateSubnet2Cidr} (256 IPs)`,
    "---",
    "Security Groups:",
    "  ALB:   ports 80, 443 from internet",
    "  ECS:   service ports from ALB only",
    "  RDS:   port 5432 from ECS only",
    "  Redis: port 6379 from ECS only",
  ]);
  console.log();

  const nat = (await select({
    message: "NAT Gateway:",
    choices: [
      { name: `single - ${NAT_PRESETS.single.label} (~$${NAT_PRESETS.single.monthlyCost}/mo)`, value: "single" },
      { name: `dual   - ${NAT_PRESETS.dual.label} (~$${NAT_PRESETS.dual.monthlyCost}/mo)`, value: "dual" },
    ],
    default: "single",
  })) as NatMode;

  const customize = await confirm({ message: "Customize networking?", default: false });

  let vpcCidr = NETWORKING_DEFAULTS.vpcCidr;
  let publicSubnet1Cidr = NETWORKING_DEFAULTS.publicSubnet1Cidr;
  let publicSubnet2Cidr = NETWORKING_DEFAULTS.publicSubnet2Cidr;
  let privateSubnet1Cidr = NETWORKING_DEFAULTS.privateSubnet1Cidr;
  let privateSubnet2Cidr = NETWORKING_DEFAULTS.privateSubnet2Cidr;

  if (customize) {
    dim("Override any CIDR. Press enter to keep the default.");
    vpcCidr = await input({ message: "VPC CIDR:", default: vpcCidr });
    publicSubnet1Cidr = await input({ message: "Public subnet 1 CIDR:", default: publicSubnet1Cidr });
    publicSubnet2Cidr = await input({ message: "Public subnet 2 CIDR:", default: publicSubnet2Cidr });
    privateSubnet1Cidr = await input({ message: "Private subnet 1 CIDR:", default: privateSubnet1Cidr });
    privateSubnet2Cidr = await input({ message: "Private subnet 2 CIDR:", default: privateSubnet2Cidr });
  }

  return { nat, vpcCidr, publicSubnet1Cidr, publicSubnet2Cidr, privateSubnet1Cidr, privateSubnet2Cidr };
}

async function promptServices(): Promise<ServiceConfig[]> {
  section("Services");

  const countRaw = await input({
    message: "Number of services (1-5):",
    default: "1",
    validate: (v) => {
      const n = Number(v);
      return (Number.isInteger(n) && n >= 1 && n <= 5) || "Enter an integer between 1 and 5.";
    },
  });
  const total = Number(countRaw);

  const services: ServiceConfig[] = [];

  for (let i = 0; i < total; i++) {
    console.log();
    header(`Configuring service ${i + 1} of ${total}:`);
    console.log();

    const name = await input({
      message: "Service name (kebab-case):",
      validate: (v) => {
        if (!isKebabCase(v)) return "Must be kebab-case.";
        if (services.some((s) => s.name === v)) return "Service names must be unique.";
        return true;
      },
    });

    const type = (await select({
      message: "Service type:",
      choices: [
        { name: "backend", value: "backend" },
        { name: "frontend", value: "frontend" },
        { name: "worker", value: "worker" },
      ],
    })) as ServiceType;

    const cpuChoices = (Object.keys(CPU_PRESETS) as CpuSize[]).map((k) => ({
      name: `${padRight(k, 7)}- ${CPU_PRESETS[k].label}  (~$${CPU_PRESETS[k].monthlyCost}/mo per replica)`,
      value: k,
    }));

    if (type === "backend") {
      const port = Number(await input({ message: "Port:", default: "3001" }));
      const domain = await input({
        message: "Domain (e.g., api.stafflogic.com):",
        validate: (v) => isValidDomain(v) || "Enter a valid domain.",
      });
      const cpu = (await select({ message: "CPU:", choices: cpuChoices })) as CpuSize;
      const min = Number(await input({ message: "Minimum replicas:", default: "2" }));
      const max = Number(await input({ message: "Maximum replicas:", default: "10" }));
      const command = await input({
        message: "Start command:",
        validate: (v) => v.length > 0 || "Command is required.",
      });
      const healthPath = await input({ message: "Health check path:", default: "/api" });
      services.push({
        name, type, port, domain, cpu,
        scaling: { min, max, cpuTarget: ECS_DEFAULTS.autoScaleCpuTarget },
        command,
        healthCheck: { path: healthPath, codes: ECS_DEFAULTS.healthCheckCodes },
      });
    } else if (type === "frontend") {
      const port = Number(await input({ message: "Port:", default: "3000" }));
      const domain = await input({
        message: "Domain (e.g., admin.stafflogic.com):",
        validate: (v) => isValidDomain(v) || "Enter a valid domain.",
      });
      const wildcard = await confirm({
        message: "Wildcard subdomains? (e.g., acme.stafflogic.com)",
        default: false,
      });
      let wildcardPort: number | undefined;
      if (wildcard) {
        wildcardPort = Number(await input({ message: "Wildcard port:", default: "3002" }));
      }
      const cpu = (await select({ message: "CPU:", choices: cpuChoices })) as CpuSize;
      const min = Number(await input({ message: "Minimum replicas:", default: "1" }));
      const max = Number(await input({ message: "Maximum replicas:", default: "3" }));
      const command = await input({
        message: "Start command:",
        validate: (v) => v.length > 0 || "Command is required.",
      });
      const healthPath = await input({ message: "Health check path:", default: "/" });
      services.push({
        name, type, port, domain, wildcard, wildcardPort, cpu,
        scaling: { min, max, cpuTarget: ECS_DEFAULTS.autoScaleCpuTarget },
        command,
        healthCheck: { path: healthPath, codes: ECS_DEFAULTS.healthCheckCodes },
      });
    } else {
      const cpu = (await select({ message: "CPU:", choices: cpuChoices })) as CpuSize;
      const min = Number(await input({ message: "Minimum replicas:", default: "1" }));
      const max = Number(await input({ message: "Maximum replicas:", default: "1" }));
      const command = await input({
        message: "Start command:",
        validate: (v) => v.length > 0 || "Command is required.",
      });

      const inheritChoices = [
        { name: "none", value: "" },
        ...services.filter((s) => s.type !== "worker").map((s) => ({ name: s.name, value: s.name })),
      ];
      const inheritEnvFrom = await select({
        message: "Inherit environment from:",
        choices: inheritChoices,
        default: "",
      });

      services.push({
        name, type, cpu,
        scaling: { min, max, cpuTarget: ECS_DEFAULTS.autoScaleCpuTarget },
        command,
        inheritEnvFrom: inheritEnvFrom || undefined,
      });
    }
  }

  console.log();
  dim("Service defaults applied:");
  console.log();
  box([
    `Health check interval:    ${ECS_DEFAULTS.healthCheckInterval} seconds`,
    `Health check timeout:     ${ECS_DEFAULTS.healthCheckTimeout} seconds`,
    `Healthy threshold:        ${ECS_DEFAULTS.healthyThreshold} consecutive checks`,
    `Unhealthy threshold:      ${ECS_DEFAULTS.unhealthyThreshold} consecutive checks`,
    `Health check codes:       ${ECS_DEFAULTS.healthCheckCodes}`,
    `Auto-scaling target:      ${ECS_DEFAULTS.autoScaleCpuTarget}% CPU utilization`,
    `Deployment strategy:      rolling update`,
    `Circuit breaker:          enabled (auto-rollback)`,
    `ECS Exec:                 enabled`,
  ]);
  console.log();

  const customize = await confirm({ message: "Customize service defaults?", default: false });
  if (customize) {
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

  return services;
}

interface DataStoreAnswers {
  database: HeizenConfig["database"];
  cache: HeizenConfig["cache"];
  storage: HeizenConfig["storage"];
}

async function promptDataStores(): Promise<DataStoreAnswers> {
  section("Data Stores");

  const dbEngine = await select({
    message: "Database:",
    choices: [
      { name: "PostgreSQL", value: "postgres" },
      { name: "None", value: "none" },
    ],
    default: "postgres",
  });

  let dbSize: DbSize = "small";
  let dbDeletionProtection = DATABASE_DEFAULTS.deletionProtection;

  if (dbEngine === "postgres") {
    dbSize = (await select({
      message: "Size:",
      choices: (Object.keys(DB_PRESETS) as DbSize[]).map((k) => ({
        name: `${padRight(k, 7)}- ${DB_PRESETS[k].instanceClass} / ${DB_PRESETS[k].label}  (~$${DB_PRESETS[k].monthlyCost}/mo)`,
        value: k,
      })),
    })) as DbSize;

    console.log();
    dim("Database defaults:");
    box([
      `Engine version:        PostgreSQL ${DATABASE_DEFAULTS.engineVersion}`,
      `Allocated storage:     ${DATABASE_DEFAULTS.allocatedStorage} GB (${DATABASE_DEFAULTS.storageType})`,
      `Backup retention:      ${DATABASE_DEFAULTS.backupRetentionPeriod} days`,
      `Encryption:            enabled`,
      `Deletion protection:   enabled`,
      `Subnets:               private subnets across 2 AZs`,
      `Access:                private subnet, ECS SG only`,
    ]);
    console.log();

    const customize = await confirm({ message: "Customize database settings?", default: false });
    if (customize) {
      dbDeletionProtection = await confirm({
        message: "Enable deletion protection?",
        default: DATABASE_DEFAULTS.deletionProtection,
      });
    }
  }

  const cacheEngine = await select({
    message: "Cache:",
    choices: [
      { name: "Redis", value: "redis" },
      { name: "None", value: "none" },
    ],
    default: "redis",
  });

  let cacheSize: CacheSize = "small";
  if (cacheEngine === "redis") {
    cacheSize = (await select({
      message: "Size:",
      choices: (Object.keys(CACHE_PRESETS) as CacheSize[]).map((k) => ({
        name: `${padRight(k, 7)}- ${CACHE_PRESETS[k].nodeType} / ${CACHE_PRESETS[k].label}  (~$${CACHE_PRESETS[k].monthlyCost}/mo)`,
        value: k,
      })),
    })) as CacheSize;

    console.log();
    dim("Cache defaults:");
    box([
      `Engine version:        Redis ${CACHE_DEFAULTS.engineVersion}`,
      `Access:                private subnet, ECS SG only`,
    ]);
    console.log();
  }

  const storageEnabled = await confirm({
    message: "Provision S3 bucket for file storage?",
    default: true,
  });

  return {
    database: {
      engine: dbEngine as "postgres" | "none",
      size: dbSize,
      deletionProtection: dbDeletionProtection,
    },
    cache: {
      engine: cacheEngine as "redis" | "none",
      size: cacheSize,
    },
    storage: { enabled: storageEnabled },
  };
}

async function promptSecrets(project: string, env: string): Promise<HeizenConfig["smtp"]> {
  section("Secrets & SMTP");

  dim("Auto-generated secrets (stored in AWS Secrets Manager):");
  console.log(`  • ${project}-${env}/db-password`);
  console.log(`  • ${project}-${env}/better-auth-secret`);
  console.log();

  const configureSmtp = await confirm({ message: "Configure SMTP for email?", default: false });
  if (!configureSmtp) return undefined;

  const host = await input({ message: "SMTP host:", default: "email-smtp.us-east-1.amazonaws.com" });
  const port = await input({ message: "SMTP port:", default: "465" });
  const user = await input({ message: "SMTP user:" });
  const pass = await password({ message: "SMTP password:" });
  const from = await input({ message: "From email:" });
  const fromName = await input({ message: "From name:" });

  if (!process.env.HEIZEN_SMTP_CREDENTIALS) {
    process.env.HEIZEN_SMTP_USER = user;
    process.env.HEIZEN_SMTP_PASSWORD = pass;
  }

  console.log();
  console.log(`  • ${project}-${env}/smtp-credentials (from your input)`);

  return { host, port, from, fromName };
}

function buildConfig(input: {
  project: string;
  env: string;
  region: string;
  awsProfile: string;
  domain: string;
  ecr: { image: string; tag: string };
  networking: NetworkingAnswers;
  services: ServiceConfig[];
  database: HeizenConfig["database"];
  cache: HeizenConfig["cache"];
  storage: HeizenConfig["storage"];
  smtp?: HeizenConfig["smtp"];
}): HeizenConfig {
  const config: HeizenConfig = {
    version: 1,
    project: input.project,
    env: input.env,
    region: input.region,
    awsProfile: input.awsProfile,
    domain: input.domain,
    ecr: input.ecr,
    services: input.services,
    database: input.database,
    cache: input.cache,
    storage: input.storage,
    networking: input.networking,
  };
  if (input.smtp) config.smtp = input.smtp;
  return config;
}

function printSummary(cfg: HeizenConfig): void {
  section("Infrastructure Summary");

  console.log(`  Project:  ${cfg.project}`);
  console.log(`  Env:      ${cfg.env}`);
  console.log(`  Region:   ${cfg.region}`);
  console.log(`  Domain:   ${cfg.domain}`);
  console.log();

  header("  Networking:");
  console.log(`    VPC ${cfg.networking.vpcCidr ?? NETWORKING_DEFAULTS.vpcCidr} across 2 AZs`);
  console.log(`    NAT: ${NAT_PRESETS[cfg.networking.nat].label}`);
  console.log();

  const servicesWithDomain = cfg.services.filter((s) => s.domain);
  if (servicesWithDomain.length > 0) {
    header("  Load Balancer:");
    console.log("    Application Load Balancer with host-based routing");
    console.log("    HTTP :80 → HTTPS redirect");
    console.log("    HTTPS :443 routing:");
    for (const svc of servicesWithDomain) {
      console.log(`      ${svc.domain} → ${svc.name} (port ${svc.port})`);
      if (svc.wildcard && svc.wildcardPort) {
        console.log(`      *.${cfg.domain} → ${svc.name} (port ${svc.wildcardPort})`);
      }
    }
    console.log(`    SSL: ACM wildcard certificate (*.${cfg.domain} + ${cfg.domain})`);
    console.log();
  }

  header("  Compute:");
  const colName = 14;
  const colCpu = 12;
  const colMem = 8;
  const colRep = 10;
  const colCost = 9;
  console.log(`    ${padRight("Service", colName)} ${padRight("CPU", colCpu)} ${padRight("Memory", colMem)} ${padRight("Replicas", colRep)} ${padRight("Cost/mo", colCost)}`);
  for (const svc of cfg.services) {
    const p = CPU_PRESETS[svc.cpu];
    const cost = p.monthlyCost * svc.scaling.min;
    console.log(`    ${padRight(svc.name, colName)} ${padRight(p.label.split(" / ")[0], colCpu)} ${padRight(p.label.split(" / ")[1] ?? "", colMem)} ${padRight(`${svc.scaling.min}-${svc.scaling.max}`, colRep)} ${padRight(`$${cost}`, colCost)}`);
  }
  console.log();

  header("  Data Stores:");
  if (cfg.database.engine === "postgres") {
    const p = DB_PRESETS[cfg.database.size];
    console.log(`    PostgreSQL ${DATABASE_DEFAULTS.engineVersion} (${p.instanceClass}) ~ $${p.monthlyCost}/mo`);
  }
  if (cfg.cache.engine === "redis") {
    const p = CACHE_PRESETS[cfg.cache.size];
    console.log(`    Redis ${CACHE_DEFAULTS.engineVersion} (${p.nodeType}) ~ $${p.monthlyCost}/mo`);
  }
  if (cfg.storage.enabled) console.log("    S3 bucket (versioning, AES-256, public access blocked)");
  console.log();

  let total = 0;
  const lines: string[] = [];
  for (const svc of cfg.services) {
    const p = CPU_PRESETS[svc.cpu];
    const cost = p.monthlyCost * svc.scaling.min;
    total += cost;
    lines.push(`ECS: ${svc.name} (${svc.cpu} × ${svc.scaling.min})    $${cost.toFixed(2)}`);
  }
  const natCost = NAT_PRESETS[cfg.networking.nat].monthlyCost;
  total += natCost;
  lines.push(`NAT Gateway (${cfg.networking.nat})         $${natCost.toFixed(2)}`);

  if (servicesWithDomain.length > 0) {
    total += ALB_MONTHLY_COST;
    lines.push(`Application Load Balancer        $${ALB_MONTHLY_COST.toFixed(2)}`);
  }
  if (cfg.database.engine === "postgres") {
    const cost = DB_PRESETS[cfg.database.size].monthlyCost;
    total += cost;
    lines.push(`RDS PostgreSQL (${cfg.database.size})         $${cost.toFixed(2)}`);
  }
  if (cfg.cache.engine === "redis") {
    const cost = CACHE_PRESETS[cfg.cache.size].monthlyCost;
    total += cost;
    lines.push(`ElastiCache Redis (${cfg.cache.size})      $${cost.toFixed(2)}`);
  }
  total += STORAGE_OVERHEAD_MONTHLY;
  lines.push(`S3 + CloudWatch + Secrets Manager $${STORAGE_OVERHEAD_MONTHLY.toFixed(2)}`);
  lines.push("---");
  lines.push(`Total                            $${total.toFixed(2)}/mo`);

  header("  Estimated Monthly Cost:");
  box(lines);
  console.log();
}

function saveYaml(cfg: HeizenConfig): void {
  const yamlPath = resolve(process.cwd(), "heizen.yaml");
  const content = yaml.dump(cfg, { lineWidth: 120, noRefs: true });
  writeFileSync(yamlPath, content, "utf8");
  success(`Wrote heizen.yaml`);
}

async function installDeps(): Promise<void> {
  const infraDir = resolve(process.cwd(), "infra");
  if (!existsSync(infraDir)) return;

  const spinner = ora("Installing dependencies...").start();
  try {
    await execa("npm", ["install"], { cwd: infraDir });
    spinner.succeed("Dependencies installed");
  } catch (e) {
    spinner.fail("npm install failed (you can run 'npm install' manually in ./infra)");
  }
}
