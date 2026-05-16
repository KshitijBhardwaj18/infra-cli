import { confirm, input, select } from "@inquirer/prompts";

import { CACHE_DEFAULTS, CACHE_PRESETS, DATABASE_DEFAULTS, DB_PRESETS } from "../../../schema/presets.js";
import type { CacheSize, DbSize, HeizenConfig } from "../../../schema/types.js";
import { box, dim, padRight, section } from "../../../ui/index.js";

export interface DataStoreAnswers {
  database: HeizenConfig["database"];
  cache: HeizenConfig["cache"];
  storage: HeizenConfig["storage"];
}

export async function promptDataStores(projectName: string): Promise<DataStoreAnswers> {
  section("Data Stores");
  const database = await promptDatabase(projectName);
  const cache = await promptCache();
  const storage = await promptStorage();
  return { database, cache, storage };
}

async function promptDatabase(projectName: string): Promise<HeizenConfig["database"]> {
  const engine = await select({
    message: "Database:",
    choices: [
      { name: "PostgreSQL", value: "postgres" },
      { name: "None", value: "none" },
    ],
    default: "postgres",
  });

  if (engine === "none") {
    return { engine: "none", size: "small", deletionProtection: DATABASE_DEFAULTS.deletionProtection };
  }

  const size = (await select({
    message: "Size:",
    choices: (Object.keys(DB_PRESETS) as DbSize[]).map((k) => ({
      name: `${padRight(k, 7)}- ${DB_PRESETS[k].instanceClass} / ${DB_PRESETS[k].label}  (~$${DB_PRESETS[k].monthlyCost}/mo)`,
      value: k,
    })),
  })) as DbSize;

  printDatabaseDefaults();

  let deletionProtection = DATABASE_DEFAULTS.deletionProtection;
  let dbName = projectName.replace(/-/g, "_");
  const customize = await confirm({ message: "Customize database settings?", default: false });
  if (customize) {
    deletionProtection = await confirm({
      message: "Enable deletion protection?",
      default: DATABASE_DEFAULTS.deletionProtection,
    });
    dbName = await input({
      message: "Database name:",
      default: dbName,
      validate: (v) => /^[a-z_][a-z0-9_]*$/.test(v) || "Use lowercase, numbers, underscores.",
    });
  }

  return { engine: "postgres", size, deletionProtection, dbName };
}

async function promptCache(): Promise<HeizenConfig["cache"]> {
  const engine = await select({
    message: "Cache:",
    choices: [
      { name: "Redis", value: "redis" },
      { name: "None", value: "none" },
    ],
    default: "redis",
  });

  if (engine === "none") return { engine: "none", size: "small" };

  const size = (await select({
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

  return { engine: "redis", size };
}

async function promptStorage(): Promise<HeizenConfig["storage"]> {
  const enabled = await confirm({
    message: "Provision S3 bucket for file storage?",
    default: true,
  });
  return { enabled };
}

function printDatabaseDefaults(): void {
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
}
