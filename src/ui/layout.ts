import chalk from "chalk";

const SECTION_WIDTH = 55;

export function section(title: string): void {
  const dashes = "─".repeat(Math.max(0, SECTION_WIDTH - title.length - 5));
  console.log();
  console.log(chalk.bold(`── ${title} ${dashes}`));
  console.log();
}

export function nextSteps(lines: string[]): void {
  console.log();
  console.log(chalk.bold("Next steps:"));
  lines.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
  console.log();
}
