import chalk from "chalk";

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
