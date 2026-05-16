import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import Handlebars from "handlebars";

import type { TemplateContext } from "./types.js";

const here = dirname(fileURLToPath(import.meta.url));

// dist/generator/ vs src/generator/ — same file is referenced from both layouts.
const TEMPLATE_DIRS = [
  join(here, "templates"),
  join(here, "..", "..", "src", "generator", "templates"),
];

registerHelpers();

export function renderTemplate(name: string, ctx: TemplateContext): string {
  const filename = `${name}.hbs`;
  const path = TEMPLATE_DIRS.map((d) => join(d, filename)).find(existsSync);
  if (!path) throw new Error(`Template not found: ${filename}`);
  const tpl = Handlebars.compile(readFileSync(path, "utf8"), { noEscape: true });
  return tpl(ctx);
}

export function camelize(s: string): string {
  return s.replace(/-([a-z0-9])/g, (_, c: string) => c.toUpperCase());
}

function registerHelpers(): void {
  Handlebars.registerHelper("camel", (s: string) => camelize(s));
  Handlebars.registerHelper("eq", (a: unknown, b: unknown) => a === b);
  Handlebars.registerHelper("priority", (index: number) => (index + 1) * 100);
  Handlebars.registerHelper("jsonString", (v: unknown) => JSON.stringify(v));
  Handlebars.registerHelper("join", (arr: unknown, sep: string) => Array.isArray(arr) ? arr.join(sep) : "");
}
