import { input, select, confirm, password, checkbox } from "@inquirer/prompts";
import chalk from "chalk";

import {
  CPU_PRESETS, DB_PRESETS, CACHE_PRESETS, NAT_PRESETS,
  NETWORKING_DEFAULTS, DATABASE_DEFAULTS, CACHE_DEFAULTS,
  ECS_DEFAULTS, REGIONS, ALB_MONTHLY_COST, STORAGE_OVERHEAD_MONTHLY,
} from "../schema/presets.js";
import type {
  HeizenConfig, HeizenEnvConfig, ServiceConfig, CpuSize, DbSize, CacheSize,
  NatMode, ServiceType, SecretSpec,
} from "../schema/types.js";
import { isKebabCase, isValidDomain, isValidEnvVar, suggestEnvVar } from "../schema/validator.js";
import { section, box, success, info, dim, header, nextSteps, padRight, failure } from "../ui.js";
import { writeConfig, writeEnvConfig, readConfig, ensureGitignore } from "../files.js";
import { runGenerate } from "./generate.js";
import { checkPrerequisites } from "../prereqs.js";

export async function runInit(opts: { envOnly?: boolean } = {}): Promise<void> {
  console.log();
  console.log(chalk.bold.cyan("Heizen Infra Init"));

  await checkPrerequisites();

  if (opts.envOnly) {
    const cfg = readConfig();
    if (!cfg) {
      failure("heizen.yaml not found. Run 'heizen infra init' without --env-only.");
      process.exit(1);
    }
    dim("Configuring runtime (heizen.env.yaml) only. Infrastructure shape (heizen.yaml) untouched.");

    const awsProfile = await promptAwsProfile();
    const secrets = await promptSecrets(cfg.services);
    const env = await promptEnvVars(cfg);

    const envCfg: HeizenEnvConfig = { awsProfile, secrets, env };
    writeEnvConfig(envCfg);
    ensureGitignore();
    success("Wrote heizen.env.yaml");
    info("Next: Run 'heizen infra generate'");
    return;
  }

  dim("Generates Pulumi infrastructure for AWS ECS Fargate.");

  const project = await promptProject();
  const networking = await promptNetworking(project.region);
  const services = await promptServices();
  const data = await promptDataStores(project.project);

  const cfg: HeizenConfig = {
    version: 1,
    project: project.project,
    env: project.env,
    region: project.region,
    domain: project.domain,
    ecr: project.ecr,
    networking,
    services,
    database: data.database,
    cache: data.cache,
    storage: data.storage,
  };

  const awsProfile = await promptAwsProfile();
  const secrets = await promptSecrets(services);
  const env = await promptEnvVars(cfg);

  const envCfg: HeizenEnvConfig = { awsProfile, secrets, env };

  printSummary(cfg, envCfg);

  const proceed = await confirm({
    message: "Generate infrastructure code?",
    default: true,
  });

  writeConfig(cfg);
  writeEnvConfig(envCfg);
  ensureGitignore();
  success("Wrote heizen.yaml");
  success("Wrote heizen.env.yaml (gitignored)");
  success(".gitignore updated");

  if (!proceed) {
    info("Config saved. Run 'heizen infra generate' when ready.");
    return;
  }

  await runGenerate({ silent: false });

  nextSteps([
    "Run 'heizen infra deploy' to provision infrastructure",
    `Push a Docker image to ${cfg.ecr.image}:${cfg.ecr.tag}`,
    "Add DNS records (shown after deploy)",
  ]);
}

interface ProjectAnswers {
  project: string;
  env: string;
  region: string;
  domain: string;
  ecr: { image: string; tag: string };
}

async function promptProject(): Promise<ProjectAnswers> {
  section("Project Configuration");
  dim("Identifying details for the new infrastructure stack.");
  console.log();

  const project = await input({
    message: "Project name (kebab-case, e.g., my-project):",
    validate: (v) => isKebabCase(v) || "Must be kebab-case (lowercase, numbers, dashes).",
  });
  const env = await input({ message: "Environment:", default: "prod" });
  const region = await select({
    message: "AWS region:",
    choices: REGIONS.map((r) => ({ name: r, value: r })),
    default: "us-east-1",
  });
  const domain = await input({
    message: "Root domain (e.g., myapp.com):",
    validate: (v) => isValidDomain(v) || "Enter a valid domain like example.com.",
  });
  const ecrImage = await input({
    message: `ECR image URI (e.g., 123456789.dkr.ecr.${region}.amazonaws.com/${project}):`,
    validate: (v) => v.includes("dkr.ecr.") || "Provide a full ECR repository URI.",
  });
  const ecrTag = await input({ message: "ECR image tag:", default: "latest" });

  return { project, env, region, domain, ecr: { image: ecrImage, tag: ecrTag } };
}

async function promptNetworking(region: string): Promise<HeizenConfig["networking"]> {
  section("Networking");

  dim("Using standard networking defaults:");
  console.log();
  box([
    `VPC:               ${NETWORKING_DEFAULTS.vpcCidr} (65,536 IPs)`,
    `Availability Zones: ${region}${NETWORKING_DEFAULTS.az1Suffix}, ${region}${NETWORKING_DEFAULTS.az2Suffix}`,
    "Public Subnets (ALB, NAT):",
    `  ${region}${NETWORKING_DEFAULTS.az1Suffix}: ${NETWORKING_DEFAULTS.publicSubnet1Cidr}`,
    `  ${region}${NETWORKING_DEFAULTS.az2Suffix}: ${NETWORKING_DEFAULTS.publicSubnet2Cidr}`,
    "Private Subnets (ECS, RDS, Redis):",
    `  ${region}${NETWORKING_DEFAULTS.az1Suffix}: ${NETWORKING_DEFAULTS.privateSubnet1Cidr}`,
    `  ${region}${NETWORKING_DEFAULTS.az2Suffix}: ${NETWORKING_DEFAULTS.privateSubnet2Cidr}`,
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
  const out: HeizenConfig["networking"] = { nat };
  if (customize) {
    dim("Override any CIDR. Press enter to keep the default.");
    out.vpcCidr = await input({ message: "VPC CIDR:", default: NETWORKING_DEFAULTS.vpcCidr });
    out.publicSubnet1Cidr = await input({ message: "Public subnet 1 CIDR:", default: NETWORKING_DEFAULTS.publicSubnet1Cidr });
    out.publicSubnet2Cidr = await input({ message: "Public subnet 2 CIDR:", default: NETWORKING_DEFAULTS.publicSubnet2Cidr });
    out.privateSubnet1Cidr = await input({ message: "Private subnet 1 CIDR:", default: NETWORKING_DEFAULTS.privateSubnet1Cidr });
    out.privateSubnet2Cidr = await input({ message: "Private subnet 2 CIDR:", default: NETWORKING_DEFAULTS.privateSubnet2Cidr });
  }
  return out;
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
        message: "Domain (e.g., api.myapp.com):",
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
        message: "Domain (e.g., app.myapp.com):",
        validate: (v) => isValidDomain(v) || "Enter a valid domain.",
      });
      const wildcard = await confirm({
        message: "Wildcard subdomains? (e.g., tenant.myapp.com)",
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

async function promptDataStores(projectName: string): Promise<DataStoreAnswers> {
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
  let dbName = projectName.replace(/-/g, "_");

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
      `Access:                private subnet, ECS SG only`,
    ]);
    console.log();

    const customize = await confirm({ message: "Customize database settings?", default: false });
    if (customize) {
      dbDeletionProtection = await confirm({
        message: "Enable deletion protection?",
        default: DATABASE_DEFAULTS.deletionProtection,
      });
      dbName = await input({
        message: "Database name:",
        default: dbName,
        validate: (v) => /^[a-z_][a-z0-9_]*$/.test(v) || "Use lowercase, numbers, underscores.",
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
      dbName: dbEngine === "postgres" ? dbName : undefined,
    },
    cache: {
      engine: cacheEngine as "redis" | "none",
      size: cacheSize,
    },
    storage: { enabled: storageEnabled },
  };
}

async function promptAwsProfile(): Promise<string> {
  section("AWS Profile");
  dim("Used by deploy/destroy. Stored in heizen.env.yaml (gitignored).");
  console.log();
  return await input({ message: "AWS profile:", default: "default" });
}

async function promptSecrets(services: ServiceConfig[]): Promise<SecretSpec[]> {
  section("Secrets");
  dim("Secrets are stored in Pulumi encrypted config (per stack, never plaintext).");
  dim("Auto-generated secrets get random values on first deploy.");
  dim("Manual secrets can have a value here (file is gitignored) or be prompted during deploy.");
  console.log();

  const serviceChoices = services.map((s) => ({
    name: `${s.name} (${s.type})`,
    value: s.name,
    checked: s.type === "backend" || s.type === "worker",
  }));

  const secrets: SecretSpec[] = [];

  const dbServices = services.filter((s) => s.type === "backend" || s.type === "worker").map((s) => s.name);
  if (dbServices.length > 0) {
    secrets.push({
      name: "db-password",
      envVar: "DATABASE_PASSWORD",
      services: dbServices,
      generate: true,
    });
    secrets.push({
      name: "auth-secret",
      envVar: "AUTH_SECRET",
      services: dbServices,
      generate: true,
    });
    console.log(chalk.bold("Pre-seeded generated secrets:"));
    for (const s of secrets) {
      console.log(`  • ${s.name} → ${s.envVar} → [${s.services.join(", ")}] ${chalk.dim("(generated)")}`);
    }
    console.log();
  }

  while (true) {
    const more = await confirm({
      message: secrets.length > 0 ? "Add another secret?" : "Add a secret?",
      default: false,
    });
    if (!more) break;

    const kind = await select({
      message: "Secret kind:",
      choices: [
        { name: "generated — CLI creates a random value on first deploy", value: "generated" },
        { name: "manual    — you provide the value (now or during deploy)", value: "manual" },
      ],
    });

    const name = await input({
      message: "Secret name (kebab-case, e.g., stripe-secret-key):",
      validate: (v) => {
        if (!isKebabCase(v)) return "Must be kebab-case.";
        if (secrets.some((s) => s.name === v)) return "Already added.";
        return true;
      },
    });
    const envVar = await input({
      message: "Env var name:",
      default: suggestEnvVar(name),
      validate: (v) => isValidEnvVar(v) || "Must be UPPER_SNAKE_CASE.",
    });
    const selected = (await checkbox({
      message: "Which services need this?",
      choices: serviceChoices,
    })) as string[];

    if (kind === "generated") {
      secrets.push({ name, envVar, services: selected, generate: true });
    } else {
      const provideNow = await confirm({
        message: "Provide the value now? (stored in gitignored heizen.env.yaml)",
        default: false,
      });
      let value: string | undefined;
      if (provideNow) {
        value = await password({
          message: `Value for ${envVar}:`,
          mask: "*",
          validate: (v) => v.length > 0 || "A value is required.",
        });
      }
      const spec: SecretSpec = { name, envVar, services: selected };
      if (value) spec.value = value;
      secrets.push(spec);
    }
  }

  return secrets;
}

async function promptEnvVars(cfg: HeizenConfig): Promise<HeizenEnvConfig["env"]> {
  section("Environment Variables");
  dim("Non-sensitive configuration values.");
  dim("Stored in heizen.env.yaml (gitignored).");
  console.log();

  dim("Auto-injected by infrastructure (you don't set these):");
  const autoLines: string[] = [];
  if (cfg.database.engine === "postgres") autoLines.push(`DATABASE_URL    = from RDS output     (auto)`);
  if (cfg.cache.engine === "redis") autoLines.push(`REDIS_URL       = from Redis output   (auto)`);
  if (cfg.storage.enabled) {
    autoLines.push(`AWS_S3_BUCKET   = from S3 output      (auto)`);
    autoLines.push(`AWS_S3_REGION   = ${cfg.region}            (auto)`);
  }
  autoLines.push(`NODE_ENV        = production          (auto)`);
  box(autoLines);
  console.log();

  const env: HeizenEnvConfig["env"] = {};
  const shared: Record<string, string> = {};

  console.log(chalk.bold("Shared env vars (injected into all backend/worker services):"));
  while (true) {
    const more = await confirm({ message: "Add a shared variable?", default: false });
    if (!more) break;
    const key = await input({
      message: "Key:",
      validate: (v) => isValidEnvVar(v) || "Must be UPPER_SNAKE_CASE.",
    });
    const value = await input({ message: "Value:" });
    shared[key] = value;
  }
  if (Object.keys(shared).length > 0) env.shared = shared;

  for (const svc of cfg.services) {
    console.log();
    const addPerService = await confirm({
      message: `Add env vars for "${svc.name}"?`,
      default: false,
    });
    if (!addPerService) continue;

    const perService: Record<string, string> = {};
    while (true) {
      const key = await input({
        message: "Key:",
        validate: (v) => isValidEnvVar(v) || "Must be UPPER_SNAKE_CASE.",
      });
      const value = await input({ message: "Value:" });
      perService[key] = value;
      const more = await confirm({ message: "Add another?", default: false });
      if (!more) break;
    }
    if (Object.keys(perService).length > 0) env[svc.name] = perService;
  }

  return env;
}

function printSummary(cfg: HeizenConfig, envCfg: HeizenEnvConfig): void {
  section("Infrastructure Summary");

  console.log(`  Project:  ${cfg.project}`);
  console.log(`  Env:      ${cfg.env}`);
  console.log(`  Region:   ${cfg.region}`);
  console.log(`  Domain:   ${cfg.domain}`);
  console.log(`  Profile:  ${envCfg.awsProfile}`);
  console.log();

  header("  Networking:");
  console.log(`    VPC ${cfg.networking.vpcCidr ?? NETWORKING_DEFAULTS.vpcCidr} across 2 AZs`);
  console.log(`    NAT: ${NAT_PRESETS[cfg.networking.nat].label}`);
  console.log();

  const servicesWithDomain = cfg.services.filter((s) => s.domain);
  if (servicesWithDomain.length > 0) {
    header("  Load Balancer:");
    console.log("    HTTP :80 → HTTPS redirect");
    for (const svc of servicesWithDomain) {
      console.log(`    HTTPS: ${svc.domain} → ${svc.name} (port ${svc.port})`);
      if (svc.wildcard && svc.wildcardPort) {
        console.log(`    HTTPS: *.${cfg.domain} → ${svc.name} (port ${svc.wildcardPort})`);
      }
    }
    console.log(`    SSL: ACM wildcard certificate (*.${cfg.domain} + ${cfg.domain})`);
    console.log();
  }

  header("  Compute:");
  for (const svc of cfg.services) {
    const p = CPU_PRESETS[svc.cpu];
    const cost = p.monthlyCost * svc.scaling.min;
    console.log(`    ${padRight(svc.name, 14)} ${padRight(p.label, 22)} ${padRight(`${svc.scaling.min}-${svc.scaling.max}`, 10)} $${cost}/mo`);
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
  if (cfg.storage.enabled) console.log("    S3 bucket (versioning, AES-256, private)");
  console.log();

  header("  Secrets:");
  for (const s of envCfg.secrets) {
    const kind = s.generate ? chalk.dim("(generated)") : (s.value ? chalk.dim("(value set) ") : chalk.dim("(manual)   "));
    console.log(`    ${kind} ${s.name} → ${s.envVar} → [${s.services.join(", ")}]`);
  }
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
  lines.push(`S3 + CloudWatch                  $${STORAGE_OVERHEAD_MONTHLY.toFixed(2)}`);
  lines.push("---");
  lines.push(`Total                            $${total.toFixed(2)}/mo`);

  header("  Estimated Monthly Cost:");
  box(lines);
  console.log();
}
