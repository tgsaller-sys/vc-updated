import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outputPath = resolve(root, "apps/web/src/buildInfo.ts");

let head = "unknown";

try {
  head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd: root,
    encoding: "utf8"
  }).trim();
} catch {
  // Vercel and local git builds should have Git metadata, but keep the app buildable without it.
}

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `export const buildHead = ${JSON.stringify(head)};\n`);
