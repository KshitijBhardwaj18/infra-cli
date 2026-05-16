import { input, select } from "@inquirer/prompts";

import { REGIONS } from "../../../schema/presets.js";
import { isKebabCase, isValidDomain } from "../../../schema/validator.js";
import { dim, section } from "../../../ui/index.js";

export interface ProjectAnswers {
  project: string;
  env: string;
  region: string;
  domain: string;
  ecr: { image: string; tag: string };
}

export async function promptProject(): Promise<ProjectAnswers> {
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
