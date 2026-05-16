import { execa } from "execa";

export interface ToolStatus {
  name: string;
  ok: boolean;
  version?: string;
  message: string;
  required: boolean;
}

const NODE_MIN_MAJOR = 22;

export async function checkAws(): Promise<ToolStatus> {
  try {
    const { stdout } = await execa("aws", ["--version"]);
    const version = parseAwsVersion(stdout);
    return { name: "AWS CLI", ok: true, version, message: `AWS CLI ${version}`, required: true };
  } catch {
    return {
      name: "AWS CLI",
      ok: false,
      message: "AWS CLI not found. Install: https://aws.amazon.com/cli/",
      required: true,
    };
  }
}

export async function checkPulumi(): Promise<ToolStatus> {
  try {
    const { stdout } = await execa("pulumi", ["version"]);
    const version = stdout.trim();
    return { name: "Pulumi", ok: true, version, message: `Pulumi ${version}`, required: true };
  } catch {
    return {
      name: "Pulumi",
      ok: false,
      message: "Pulumi not found. Install: https://www.pulumi.com/docs/install/",
      required: true,
    };
  }
}

export async function checkNode(): Promise<ToolStatus> {
  const version = process.versions.node;
  const major = Number(version.split(".")[0]);
  if (major >= NODE_MIN_MAJOR) {
    return { name: "Node.js", ok: true, version, message: `Node.js v${version}`, required: true };
  }
  return {
    name: "Node.js",
    ok: false,
    message: `Node.js ${NODE_MIN_MAJOR}+ required (found v${version}). Install: https://nodejs.org/`,
    required: true,
  };
}

export async function checkDocker(): Promise<ToolStatus> {
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
