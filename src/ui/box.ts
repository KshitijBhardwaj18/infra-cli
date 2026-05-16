import chalk from "chalk";
import type { ChalkInstance } from "chalk";

import { stripAnsi } from "./ansi.js";

const BOX_WIDTH = 55;

export function box(lines: string[]): void {
  drawBox(lines, chalk.dim);
}

export function warnBox(lines: string[]): void {
  drawBox(lines, chalk.red);
}

function drawBox(lines: string[], color: ChalkInstance): void {
  const inner = BOX_WIDTH - 2;
  console.log(color("┌" + "─".repeat(inner) + "┐"));
  for (const line of lines) {
    if (line === "---") {
      console.log(color("├" + "─".repeat(inner) + "┤"));
      continue;
    }
    const padding = Math.max(0, BOX_WIDTH - 4 - stripAnsi(line).length);
    console.log(color("│ ") + line + " ".repeat(padding) + color(" │"));
  }
  console.log(color("└" + "─".repeat(inner) + "┘"));
}
