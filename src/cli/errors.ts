import chalk from "chalk";

// Final error sink for the CLI. Returns the exit code the process should use.
export function handleError(err: unknown): never {
  if (isCancelled(err)) {
    console.log();
    console.log(chalk.yellow("Cancelled."));
    process.exit(0);
  }
  const message = err instanceof Error ? err.message : String(err);
  console.log();
  console.log(chalk.red(`✗ ${message}`));
  process.exit(1);
}

function isCancelled(err: unknown): boolean {
  return err instanceof Error && err.name === "ExitPromptError";
}
