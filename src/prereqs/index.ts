import chalk from "chalk";

import { section } from "../ui/layout.js";
import { ToolStatus, checkAws, checkDocker, checkNode, checkPulumi } from "./checks.js";

const NAME_COLUMN_WIDTH = 12;

export async function checkPrerequisites(): Promise<void> {
  section("Prerequisites Check");

  const checks = await Promise.all([checkAws(), checkPulumi(), checkNode(), checkDocker()]);
  for (const c of checks) printStatus(c);
  console.log();

  const missing = checks.filter((c) => c.required && !c.ok);
  if (missing.length > 0) {
    console.log(chalk.red("Required tools are missing. Install them and try again."));
    process.exit(1);
  }
}

function printStatus(c: ToolStatus): void {
  const symbol = c.ok ? chalk.green("✓") : c.required ? chalk.red("✗") : chalk.yellow("⚠");
  console.log(`  ${symbol} ${c.name.padEnd(NAME_COLUMN_WIDTH)} ${c.message}`);
}
