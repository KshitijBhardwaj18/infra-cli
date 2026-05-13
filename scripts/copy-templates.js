import { cpSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const src = resolve(here, "..", "src", "generator", "templates");
const dst = resolve(here, "..", "dist", "generator", "templates");
mkdirSync(dst, { recursive: true });
cpSync(src, dst, { recursive: true });
console.log(`Copied templates to ${dst}`);
