import chalk from "chalk";

import {
  ALB_MONTHLY_COST, CACHE_DEFAULTS, CACHE_PRESETS, CPU_PRESETS, DATABASE_DEFAULTS,
  DB_PRESETS, NAT_PRESETS, NETWORKING_DEFAULTS, STORAGE_OVERHEAD_MONTHLY,
} from "../../schema/presets.js";
import type { HeizenConfig, HeizenEnvConfig, ServiceConfig } from "../../schema/types.js";
import { AUTO_VALUE } from "../../schema/types.js";
import { box, header, padRight, section } from "../../ui/index.js";

export function printSummary(cfg: HeizenConfig, envCfg: HeizenEnvConfig): void {
  section("Infrastructure Summary");

  printProject(cfg, envCfg);
  printNetworking(cfg);
  printLoadBalancer(cfg);
  printCompute(cfg);
  printDataStores(cfg);
  printRuntimeConfig(cfg, envCfg);
  printCostEstimate(cfg);
}

function printProject(cfg: HeizenConfig, envCfg: HeizenEnvConfig): void {
  console.log(`  Project:  ${cfg.project}`);
  console.log(`  Env:      ${cfg.env}`);
  console.log(`  Region:   ${cfg.region}`);
  console.log(`  Domain:   ${cfg.domain}`);
  console.log(`  Profile:  ${envCfg.awsProfile}`);
  console.log();
}

function printNetworking(cfg: HeizenConfig): void {
  header("  Networking:");
  console.log(`    VPC ${cfg.networking.vpcCidr ?? NETWORKING_DEFAULTS.vpcCidr} across 2 AZs`);
  console.log(`    NAT: ${NAT_PRESETS[cfg.networking.nat].label}`);
  console.log();
}

function printLoadBalancer(cfg: HeizenConfig): void {
  const withDomain = cfg.services.filter((s) => s.domain);
  if (withDomain.length === 0) return;
  header("  Load Balancer:");
  console.log("    HTTP :80 → HTTPS redirect");
  for (const svc of withDomain) {
    console.log(`    HTTPS: ${svc.domain} → ${svc.name} (port ${svc.port})`);
    if (svc.wildcard && svc.wildcardPort) {
      console.log(`    HTTPS: *.${cfg.domain} → ${svc.name} (port ${svc.wildcardPort})`);
    }
  }
  console.log(`    SSL: ACM wildcard certificate (*.${cfg.domain} + ${cfg.domain})`);
  console.log();
}

function printCompute(cfg: HeizenConfig): void {
  header("  Compute:");
  for (const svc of cfg.services) {
    const p = CPU_PRESETS[svc.cpu];
    const cost = p.monthlyCost * svc.scaling.min;
    console.log(`    ${padRight(svc.name, 14)} ${padRight(p.label, 22)} ${padRight(`${svc.scaling.min}-${svc.scaling.max}`, 10)} $${cost}/mo`);
  }
  console.log();
}

function printDataStores(cfg: HeizenConfig): void {
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
}

function printRuntimeConfig(cfg: HeizenConfig, envCfg: HeizenEnvConfig): void {
  header("  Runtime config:");
  if (cfg.database.engine === "postgres") {
    console.log(`    ${chalk.dim("(infra)    ")} DB_PASSWORD`);
  }
  printEnvScope(envCfg.env.shared, "shared");
  for (const svc of cfg.services) {
    printEnvScope(envCfg.env[svc.name], svc.name);
  }
  console.log();
}

function printEnvScope(vars: Record<string, string> | undefined, label: string): void {
  if (!vars) return;
  for (const [key, value] of Object.entries(vars)) {
    const tag = value === AUTO_VALUE ? "(generated)" : `(${label})`;
    console.log(`    ${chalk.dim(tag.padEnd(11))} ${key}`);
  }
}

function printCostEstimate(cfg: HeizenConfig): void {
  const lines: string[] = [];
  let total = 0;

  for (const svc of cfg.services) {
    const cost = serviceCost(svc);
    total += cost;
    lines.push(`ECS: ${svc.name} (${svc.cpu} × ${svc.scaling.min})    $${cost.toFixed(2)}`);
  }
  const natCost = NAT_PRESETS[cfg.networking.nat].monthlyCost;
  total += natCost;
  lines.push(`NAT Gateway (${cfg.networking.nat})         $${natCost.toFixed(2)}`);
  if (cfg.services.some((s) => s.domain)) {
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

function serviceCost(svc: ServiceConfig): number {
  return CPU_PRESETS[svc.cpu].monthlyCost * svc.scaling.min;
}
