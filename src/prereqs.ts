import { execa } from "execa";
import chalk from "chalk";

import { section } from "./ui.js";

interface ToolStatus {
  name: string;
  ok: boolean;
  version?: string;
  message: string;
  required: boolean;
}

const NODE_MIN_MAJOR = 22;

export async function checkPrerequisites(): Promise<void> {
  section("Prerequisites Check");

  const checks: ToolStatus[] = [
    await checkAws(),
    await checkPulumi(),
    await checkNode(),
    await checkDocker(),
  ];

  for (const c of checks) {
    const symbol = c.ok ? chalk.green("✓") : (c.required ? chalk.red("✗") : chalk.yellow("⚠"));
    console.log(`  ${symbol} ${c.name.padEnd(12)} ${c.message}`);
  }
  console.log();

  const missingRequired = checks.filter((c) => c.required && !c.ok);
  if (missingRequired.length > 0) {
    console.log(chalk.red("Required tools are missing. Install them and try again."));
    process.exit(1);
  }
}

async function checkAws(): Promise<ToolStatus> {
  try {
    const { stdout } = await execa("aws", ["--version"]);
    const v = parseAwsVersion(stdout);
    return {
      name: "AWS CLI",
      ok: true,
      version: v,
      message: `AWS CLI ${v}`,
      required: true,
    };
  } catch {
    return {
      name: "AWS CLI",
      ok: false,
      message: "AWS CLI not found. Install: https://aws.amazon.com/cli/",
      required: true,
    };
  }
}

async function checkPulumi(): Promise<ToolStatus> {
  try {
    const { stdout } = await execa("pulumi", ["version"]);
    return {
      name: "Pulumi",
      ok: true,
      version: stdout.trim(),
      message: `Pulumi ${stdout.trim()}`,
      required: true,
    };
  } catch {
    return {
      name: "Pulumi",
      ok: false,
      message: "Pulumi not found. Install: https://www.pulumi.com/docs/install/",
      required: true,
    };
  }
}

async function checkNode(): Promise<ToolStatus> {
  const v = process.versions.node;
  const major = Number(v.split(".")[0]);
  if (major >= NODE_MIN_MAJOR) {
    return {
      name: "Node.js",
      ok: true,
      version: v,
      message: `Node.js v${v}`,
      required: true,
    };
  }
  return {
    name: "Node.js",
    ok: false,
    message: `Node.js ${NODE_MIN_MAJOR}+ required (found v${v}). Install: https://nodejs.org/`,
    required: true,
  };
}

async function checkDocker(): Promise<ToolStatus> {
  try {
    const { stdout } = await execa("docker", ["--version"]);
    return {
      name: "Docker",
      ok: true,
      version: stdout.trim(),
      message: stdout.trim(),
      required: false,
    };
  } catch {
    return {
      name: "Docker",
      ok: false,
      message: "Docker not found (optional, needed for image builds)",
      required: false,
    };
  }
}

function parseAwsVersion(stdout: string): string {
  const match = stdout.match(/aws-cli\/(\S+)/);
  return match ? match[1] : stdout.trim();
}
