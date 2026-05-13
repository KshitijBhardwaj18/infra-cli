import chalk from "chalk";

const BOX_WIDTH = 55;

export function section(title: string): void {
  const dashes = "─".repeat(Math.max(0, BOX_WIDTH - title.length - 5));
  console.log();
  console.log(chalk.bold(`── ${title} ${dashes}`));
  console.log();
}

export function box(lines: string[]): void {
  const width = BOX_WIDTH;
  const top = "┌" + "─".repeat(width - 2) + "┐";
  const bot = "└" + "─".repeat(width - 2) + "┘";
  console.log(chalk.dim(top));
  for (const line of lines) {
    if (line === "---") {
      console.log(chalk.dim("├" + "─".repeat(width - 2) + "┤"));
      continue;
    }
    const stripped = stripAnsi(line);
    const padding = Math.max(0, width - 4 - stripped.length);
    console.log(chalk.dim("│ ") + line + " ".repeat(padding) + chalk.dim(" │"));
  }
  console.log(chalk.dim(bot));
}

export function warnBox(lines: string[]): void {
  const width = BOX_WIDTH;
  const top = "┌" + "─".repeat(width - 2) + "┐";
  const bot = "└" + "─".repeat(width - 2) + "┘";
  console.log(chalk.red(top));
  for (const line of lines) {
    if (line === "---") {
      console.log(chalk.red("├" + "─".repeat(width - 2) + "┤"));
      continue;
    }
    const stripped = stripAnsi(line);
    const padding = Math.max(0, width - 4 - stripped.length);
    console.log(chalk.red("│ ") + line + " ".repeat(padding) + chalk.red(" │"));
  }
  console.log(chalk.red(bot));
}

function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function success(msg: string): void {
  console.log(chalk.green(`✓ ${msg}`));
}

export function failure(msg: string): void {
  console.log(chalk.red(`✗ ${msg}`));
}

export function info(msg: string): void {
  console.log(chalk.cyan(msg));
}

export function warn(msg: string): void {
  console.log(chalk.yellow(`⚠ ${msg}`));
}

export function dim(msg: string): void {
  console.log(chalk.dim(msg));
}

export function header(msg: string): void {
  console.log(chalk.bold(msg));
}

export function nextSteps(lines: string[]): void {
  console.log();
  console.log(chalk.bold("Next steps:"));
  lines.forEach((line, i) => console.log(`  ${i + 1}. ${line}`));
  console.log();
}

export function padRight(s: string, width: number): string {
  const stripped = stripAnsi(s);
  return s + " ".repeat(Math.max(0, width - stripped.length));
}
