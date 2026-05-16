import { input } from "@inquirer/prompts";

import { dim, section } from "../../../ui/index.js";

export async function promptAwsProfile(): Promise<string> {
  section("AWS Profile");
  dim("Used by deploy/destroy. Stored in heizen.env.yaml (gitignored).");
  console.log();
  return await input({ message: "AWS profile:", default: "default" });
}
