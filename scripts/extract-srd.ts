// Extracts text from the Daggerheart SRD 2.0 PDF.
// Usage: npm run content:extract [-- path/to/srd.pdf]
// Without a path the PDF is downloaded from daggerheart.com into a temp file.
//
// Outputs (checked in so parse errors can be spotted against the source):
//   content/srd/raw/srd-2.0.txt         readable text, one PDF line per line, table cells split by TAB
//   content/srd/raw/srd-2.0.lines.json  [page, fontSize, y, cells, kind] per line; input for the parser.
//                                       cells = [[x, text], ...]; text marks **bold** and _italic_ runs.
//                                       kind = "h" when the line is set in the heading typeface.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

export const SRD_URL = "https://www.daggerheart.com/wp-content/uploads/2026/08/DH_SRD_2_2026_08_25.pdf";
export const SRD_SHA256 = "55d8b92b7e58aa1da99a4a59aa77352483ef4fbda71baddb9af9bfc1f333bd2a";
const RAW = path.resolve("content/srd/raw");
/** Horizontal gap (pt) between text runs on one line that counts as a table-cell break. */
const CELL_GAP = 4;

export type RawCell = [x: number, text: string];
export type RawLine = [page: number, size: number, y: number, cells: RawCell[], kind: "" | "h"];
export const stripStyle = (s: string) => s.replace(/\*\*|(?<![A-Za-z0-9])_|_(?![A-Za-z0-9])/g, "");
export const lineText = (l: RawLine) => l[3].map((c) => stripStyle(c[1])).join("\t");

/** The text layer splits ligatures ("benefi ts", "Diffi    culty"). Rejoin them. */
export function fixLigatures(t: string): string {
  return t
    .replace(/(ffi|ffl|fi|fl)[ ]+(?=[a-z])/g, "$1")
    .replace(/\b(eff|diff|aff|unaff|suff|Eff|Diff|Aff|Suff)[ ]+(?=[a-z])/g, "$1")
    .replace(/\b(puff|quaff|bluff)[ ]+(?=s\b)/g, "$1");
}

/**
 * The adversary stat blocks set some digits in a symbol font whose glyphs map to Private Use code points.
 * Mapping verified against context (e.g. "Horde (U+E541 U+E53F/HP)" = "Horde (10/HP)", "2d1U+E53F" = "2d10").
 */
const PUA: Record<string, string> = {
  "": "0", "": "1", "": "2", "": "3", "": "4",
  "": "5", "": "6", "": "7", "": "8", "": "9", "": "→",
};
const fixPua = (s: string) => s.replace(/[-]/g, (c) => PUA[c] ?? c);

interface Item { str: string; x: number; y: number; w: number; size: number; bold: boolean; italic: boolean; heading: boolean }

function styled(items: Item[]): string {
  // Wrap runs of bold/italic in markdown markers; whitespace stays outside the markers.
  let out = "";
  let i = 0;
  while (i < items.length) {
    const { bold, italic } = items[i];
    let run = "";
    while (i < items.length && items[i].bold === bold && items[i].italic === italic) run += items[i++].str;
    const m = run.match(/^(\s*)(.*?)(\s*)$/s)!;
    const mark = (bold ? "**" : "") + (italic ? "_" : "");
    const close = (italic ? "_" : "") + (bold ? "**" : "");
    out += m[2] ? m[1] + mark + m[2] + close + m[3] : run;
  }
  return out;
}

function linesOf(page: number, items: Item[]): RawLine[] {
  const out: RawLine[] = [];
  let cur: Item[] = [];
  const flush = () => {
    if (!cur.length) return;
    const cells: RawCell[] = [];
    let group: Item[] = [];
    let end = cur[0].x;
    const push = () => {
      // insert spaces where runs touch without one but have a visible gap
      const joined: Item[] = group.map((it, k) => {
        if (k === 0) return it;
        const prev = group[k - 1];
        const gap = it.x - (prev.x + prev.w);
        return gap > 1 && !/\s$/.test(prev.str) && !/^\s/.test(it.str) ? { ...it, str: " " + it.str } : it;
      });
      const t = fixLigatures(styled(joined)).trim();
      if (t) cells.push([Math.round(group[0].x * 10) / 10, t]);
      group = [];
    };
    for (const it of cur) {
      if (group.length && it.x - end > CELL_GAP) push();
      group.push(it);
      end = it.x + it.w;
    }
    push();
    if (cells.length) {
      const vis = cur.filter((i) => i.str.trim());
      const size = Math.max(...vis.map((i) => i.size), 0);
      const kind = vis.length && vis.every((i) => i.heading) ? "h" : "";
      out.push([page, size, Math.round(cur[0].y * 10) / 10, cells, kind]);
    }
    cur = [];
  };
  for (const it of items) {
    const prev = cur[cur.length - 1];
    // New line when the baseline moves, or when text jumps left (column or cell wrap).
    if (prev && (Math.abs(prev.y - it.y) > 1 || it.x < prev.x - 1)) flush();
    cur.push(it);
  }
  flush();
  return out;
}

async function main() {
  let file = process.argv[2];
  if (!file) {
    file = path.join(os.tmpdir(), "srd-2.0.pdf");
    console.log("Downloading", SRD_URL);
    const res = await fetch(SRD_URL);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const buf = fs.readFileSync(file);
  const sha = crypto.createHash("sha256").update(buf).digest("hex");
  if (sha !== SRD_SHA256) console.warn(`WARNING: PDF hash ${sha} differs from the known SRD 2.0 release. Check for a new version.`);

  const doc = await getDocument({ data: new Uint8Array(buf), verbosity: 0 }).promise;
  const pages: RawLine[][] = [];
  fs.mkdirSync(RAW, { recursive: true });

  for (let n = 1; n <= doc.numPages; n++) {
    const page = await doc.getPage(n);
    const text = await page.getTextContent();
    await page.getOperatorList(); // resolves font objects so their names can be read
    const fontName = (id: string): string => {
      try {
        return (page.commonObjs.get(id) as { name?: string })?.name ?? "";
      } catch {
        return "";
      }
    };
    const items: Item[] = (text.items as any[])
      .filter((it) => "str" in it)
      .map((it) => {
        const f = fontName(it.fontName);
        return {
          str: fixPua(it.str),
          x: it.transform[4],
          y: it.transform[5],
          w: it.width,
          size: Math.round(Math.hypot(it.transform[0], it.transform[1]) * 2) / 2,
          bold: /Bold/.test(f),
          italic: /Italic/.test(f),
          heading: /Eveleth/.test(f),
        };
      });
    pages.push(linesOf(n, items));

  }

  const all = pages.flat();
  const txt = pages.map((p, i) => [`@@PDFPAGE ${i + 1}@@`, ...p.map(lineText)].join("\n")).join("\n") + "\n";
  fs.writeFileSync(path.join(RAW, "srd-2.0.txt"), txt);
  fs.writeFileSync(path.join(RAW, "srd-2.0.lines.json"), "[\n" + all.map((l) => JSON.stringify(l)).join(",\n") + "\n]\n");
  const leftoverPua = txt.match(/[-]/g);
  if (leftoverPua) console.warn("Unmapped private-use glyphs:", [...new Set(leftoverPua)].map((c) => c.codePointAt(0)!.toString(16)));
  console.log(`Wrote ${pages.length} pages, ${all.length} lines`);
}
if (process.argv[1]?.endsWith("extract-srd.ts")) main();
