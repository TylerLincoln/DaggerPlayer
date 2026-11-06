// Applies content/srd/errata.json to extracted lines before parsing (decision D7: fix SRD typos, log every fix).
import fs from "node:fs";
import type { Line } from "./lines.ts";

export interface Erratum {
  page: number;
  find: string;
  replace: string;
  note: string;
}

export function loadErrata(file = "content/srd/errata.json"): Erratum[] {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : [];
}

/** Each erratum must match exactly once on its page, so a re-extracted PDF can't silently skip or double-apply a fix. */
export function applyErrata(lines: Line[], errata: Erratum[]): Line[] {
  for (const e of errata) {
    const hits = lines.filter((l) => l.page === e.page && l.cells.some((c) => c[1].includes(e.find)));
    if (hits.length !== 1) throw new Error(`erratum p${e.page} "${e.find}" matched ${hits.length} lines (expected 1)`);
    const l = hits[0];
    l.cells = l.cells.map(([x, t]) => [x, t.replace(e.find, e.replace)]);
    l.text = l.cells.map((c) => c[1]).join("\t");
  }
  return lines;
}
