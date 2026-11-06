// Validates the bundled content packs, plus any homebrew pack files given as arguments.
// Usage: npm run content:validate [-- path/to/homebrew-pack.json ...]
// A homebrew pack file is { "meta": {...}, "entries": [...] }. Exits 1 on any error.
import fs from "node:fs";
import path from "node:path";
import { type RawPack, validatePacks } from "../content/validate.ts";

export function loadPackDir(dir: string): RawPack {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, "pack.json"), "utf8"));
  const dataDir = path.join(dir, "data");
  const entries = fs
    .readdirSync(dataDir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), "utf8")));
  return { meta, entries };
}

export function bundledPacks(root = "content"): RawPack[] {
  return fs
    .readdirSync(root)
    .filter((d) => fs.existsSync(path.join(root, d, "pack.json")))
    .sort()
    .map((d) => loadPackDir(path.join(root, d)));
}

function main() {
  const raw = [...bundledPacks(), ...process.argv.slice(2).map((f) => JSON.parse(fs.readFileSync(f, "utf8")) as RawPack)];
  const { packs, issues } = validatePacks(raw);
  for (const p of packs) console.log(`${p.meta.id} ${p.meta.version}: ${p.entries.length} entries`);
  const errors = issues.filter((i) => i.level === "error");
  const warnings = issues.filter((i) => i.level === "warning");
  for (const i of [...errors, ...warnings].slice(0, 200)) console.log(`${i.level.toUpperCase()} [${i.pack}] ${i.id ?? ""} ${i.message}`);
  if (errors.length + warnings.length > 200) console.log(`… ${errors.length + warnings.length - 200} more`);
  console.log(`${errors.length} errors, ${warnings.length} warnings`);
  process.exit(errors.length ? 1 : 0);
}
if (process.argv[1]?.endsWith("validate-packs.ts")) main();
