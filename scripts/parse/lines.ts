// Shared helpers that turn extracted PDF lines into headings, paragraphs and features.
import fs from "node:fs";
import path from "node:path";
import type { RawLine } from "../extract-srd.ts";
import { applyErrata, loadErrata } from "./errata.ts";
import type { Feature } from "../../content/schema/index.ts";

export interface Line {
  page: number;
  size: number;
  y: number;
  x: number;
  cells: [number, string][];
  /** styled text (cells joined by TAB) */
  text: string;
  heading: boolean;
}

export function loadLines(file = "content/srd/raw/srd-2.0.lines.json"): Line[] {
  const raw: RawLine[] = JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
  const lines = raw
    .map(([page, size, y, cells, kind]) => ({ page, size, y, x: cells[0][0], cells, text: cells.map((c) => c[1]).join("\t"), heading: kind === "h" }))
    .filter((l) => !isFooter(l));
  return applyErrata(lines, loadErrata());
}

/** Running footer ("Daggerheart SRD") and page numbers. */
function isFooter(l: Line): boolean {
  if (l.y > 60) return false;
  return (l.size === 8.5 && /Daggerheart SRD/.test(l.text)) || (l.size === 7.5 && /^\d+$/.test(plain(l.text)));
}

export function pages(lines: Line[], from: number, to: number): Line[] {
  return lines.filter((l) => l.page >= from && l.page <= to);
}

// ---------- text ----------

/** Remove markdown style markers. */
export const plain = (s: string) => s.replace(/\*\*/g, "").replace(/(^|[^A-Za-z0-9])_|_(?=[^A-Za-z0-9]|$)/g, "$1").replace(/\t/g, " ");

/** Normalise whitespace and drop empty style runs ("****" between two bold runs). */
export function tidy(s: string): string {
  return s
    .replace(/(\S)\*\*\*\*(\S)/g, "$1$2")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/** Join wrapped lines into one string. Keeps hyphens and dashes at line ends. */
export function joinLines(parts: string[]): string {
  let out = "";
  for (const raw of parts) {
    const p = raw.replace(/\t/g, " ").trim();
    if (!p) continue;
    if (!out) out = p;
    else if (/[-—–/]$/.test(plain(out)) && !/ [-—–]$/.test(plain(out))) out += p;
    else out += " " + p;
  }
  return tidy(out);
}

// ---------- blocks ----------

export type Block =
  | { kind: "heading"; level: number; text: string; page: number; line: Line }
  | { kind: "para"; text: string; page: number; lines: Line[]; bullet?: string };

const BULLET = /^(?:\*\*)?\s*([•◦]|\d{1,2}\.(?=\t))/;
/**
 * A feature label is the start of the first bold run, up to its first colon:
 *   **Name:** text   |   **_Name:_** text   |   **_Name_: Spend a Hope** text
 * or a whole bold-italic run ending in a period: **_Name._** text (pp. 11, 167, 195, 202).
 */
export function splitLabel(text: string): { label: string; rest: string } | null {
  const m = text.match(/^\*\*(.+?)\*\*(?!\*)/);
  if (!m) return null;
  const run = m[1];
  const after = text.slice(m[0].length);
  const flat = run.replace(/_/g, "");
  const colon = flat.indexOf(":");
  if (colon > 0 && colon <= 60) {
    const label = flat.slice(0, colon).trim();
    const boldRest = flat.slice(colon + 1).trim();
    return { label, rest: tidy((boldRest ? `**${boldRest}**` : "") + after) };
  }
  if (/^_[^_]+\._$/.test(run) && flat.length <= 60) return { label: flat.slice(0, -1).trim(), rest: tidy(after) };
  return null;
}
export const isLabel = (text: string) => splitLabel(text) !== null;

export function headingLevel(l: Line): number | null {
  // multi-cell lines in the heading face are table headers, not headings
  if (l.cells.length > 1 && !BULLET.test(l.text)) return null;
  const t = plain(l.text).trim();
  // 0 = chapter (28pt), 1 = section (17pt), 2 = 12pt, 3 = smaller
  if (l.heading) return l.size >= 24 ? 0 : l.size >= 17 ? 1 : l.size >= 12 ? 2 : 3;
  // bold all-caps lines with no trailing text act as headings
  if (/^\*\*[^*]+\*\*$/.test(l.text.trim()) && t === t.toUpperCase() && /[A-Z]{3}/.test(t) && !/:$/.test(t)) {
    return l.size >= 17 ? 1 : l.size >= 12 ? 2 : l.size >= 11 ? 3 : 4;
  }
  return null;
}

/** A paragraph cut by a column or page break: previous line has no closing punctuation and the next starts lower case. */
function continuesAcrossBreak(prev: Line, next: Line): boolean {
  const end = plain(prev.text).trim();
  const start = plain(next.text).trim();
  return prev.size === next.size && !/[.!?:”"]$/.test(end) && /^[a-z(]/.test(start);
}

/**
 * Group lines into headings and paragraphs. A new paragraph starts at a bullet, a bold label,
 * a column/page change, or a vertical gap noticeably bigger than the line spacing.
 */
export function blocks(lines: Line[], opts: { splitLabels?: boolean } = {}): Block[] {
  const splitLabels = opts.splitLabels ?? true;
  const out: Block[] = [];
  let cur: Line[] = [];
  let bullet: string | undefined;
  const flush = () => {
    if (cur.length) {
      const text = joinLines(cur.map((l, i) => (i === 0 ? l.text.replace(BULLET, "").replace(/^\t/, "") : l.text)));
      out.push({ kind: "para", text, page: cur[0].page, lines: cur, ...(bullet ? { bullet } : {}) });
    }
    cur = [];
    bullet = undefined;
  };
  for (const l of lines) {
    const lvl = headingLevel(l);
    if (lvl !== null) {
      flush();
      const last = out[out.length - 1];
      // a heading wrapped onto a second line directly below the first: merge
      if (last?.kind === "heading" && last.level === lvl && last.page === l.page && Math.abs(last.line.x - l.x) < 15 && last.line.y - l.y > 0 && last.line.y - l.y < l.size * 1.6) {
        last.text += " " + plain(l.text).trim();
        last.line = l;
        continue;
      }
      out.push({ kind: "heading", level: lvl, text: plain(l.text).trim(), page: l.page, line: l });
      continue;
    }
    const prev = cur[cur.length - 1];
    const b = l.text.match(BULLET);
    // inside a table (first line has several small cells): same-size lines on the same page continue it
    const inTable = !!prev && !bullet && cur[0].cells.length > 1 && cur[0].size <= 8.5 && !BULLET.test(cur[0].text);
    if (inTable && Math.abs(l.size - cur[0].size) <= 1 && l.page === prev.page && l.y < cur[0].y && prev.y - l.y < 30 && !b) {
      cur.push(l);
      continue;
    }
    const newPara =
      !prev ||
      !!b ||
      (splitLabels && isLabel(l.text)) ||
      ((prev.page !== l.page || l.y > prev.y + 1) && !continuesAcrossBreak(prev, l)) || // new column or page
      prev.y - l.y > Math.max(prev.size, l.size) * 1.45 ||
      (l.size !== prev.size && (Math.abs(l.size - prev.size) > 1 || /[.!?:”"]$/.test(plain(prev.text).trim())));
    if (newPara) {
      flush();
      if (b) bullet = b[1];
    }
    cur.push(l);
  }
  flush();
  return out;
}

const ASIDE = /^(Notes?|Tips?|Examples?)$/;
/** "•"/"◦" -> "-", "2." stays "2." */
const listMarker = (b: string) => (/^\d/.test(b) ? b : "-");
const ATTACK_LINE = /^(Melee|Very Close|Close|Far|Very Far) \| \S+ (phy|mag)$/;

/** Turn a paragraph that starts with a bold label into a feature. */
export function toFeature(text: string): Feature | null {
  const m = splitLabel(text);
  if (!m) return null;
  let name = m.label;
  let kind: Feature["kind"];
  const k = name.match(/^(.*?)\s+[-–]\s+(Passive|Action|Reaction|Evolution)$/i);
  if (k) {
    name = k[1].trim();
    kind = k[2].toLowerCase() as Feature["kind"];
  }
  return { name, text: m.rest, ...(kind ? { kind } : {}) };
}

/**
 * Collect features from paragraphs. Paragraphs without a label (and bullets) continue the
 * previous feature's text as new markdown paragraphs / list items.
 */
export function features(paras: Block[]): Feature[] {
  const out: Feature[] = [];
  for (const b of paras) {
    if (b.kind !== "para") continue;
    const f = !b.bullet ? toFeature(b.text) : null;
    // "Note:", "Tip:" and "Example:" asides, and replacement attack lines ("Claw Swipe: Very Close | 1d10+3 phy"),
    // belong to the feature above them.
    const aside = f && out.length && (ASIDE.test(f.name) || ATTACK_LINE.test(plain(f.text)));
    if (f && !aside) out.push(f);
    else if (out.length) {
      const last = out[out.length - 1];
      const inList = /\n(- |\d+\. )/.test("\n" + last.text.split("\n\n").pop());
      last.text += b.bullet ? (inList ? "\n" : "\n\n") + `${listMarker(b.bullet)} ${b.text}` : "\n\n" + (isTable(b) ? tableMd(b.lines) : b.text);
    } else throw new Error(`text before first feature: ${b.text.slice(0, 80)} (p${b.page})`);
  }
  return out;
}

// ---------- misc ----------

export function slug(s: string): string {
  return plain(s)
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[’'`]/g, "")
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** "AGILE SCOUT" -> "Agile Scout", keeping small words lower case. */
export function titleCase(s: string): string {
  const small = new Set(["of", "the", "and", "a", "an", "in", "on", "to", "for", "or", "from", "with", "at", "by"]);
  return plain(s)
    .toLowerCase()
    .split(/(\s+|-)/)
    .map((w, i) => (i > 0 && small.has(w) ? w : w.replace(/^(\p{L})/u, (c) => c.toUpperCase())))
    .join("")
    .replace(/’(\p{L})/gu, (_, c) => "’" + c.toLowerCase())
    .replace(/\b(Gm|Npc|Pc|Hp|Vtt)(s?)\b/g, (_, w, pl) => w.toUpperCase() + pl);
}

export const TRAIT_NAMES: Record<string, string> = {
  agility: "agility", strength: "strength", finesse: "finesse", instinct: "instinct", presence: "presence", knowledge: "knowledge",
};
export function trait(s: string) {
  const t = plain(s).trim().toLowerCase();
  if (!(t in TRAIT_NAMES)) throw new Error(`unknown trait "${s}"`);
  return t as import("../../content/schema/index.ts").Trait;
}
export function range(s: string) {
  const r = plain(s).trim().toLowerCase().replace(/\s+/g, "-");
  if (!["melee", "very-close", "close", "far", "very-far"].includes(r)) throw new Error(`unknown range "${s}"`);
  return r as "melee" | "very-close" | "close" | "far" | "very-far";
}

/** Paragraph blocks -> markdown. Consecutive bullets form one list. */
export function md(paras: Block[]): string {
  let out = "";
  let prevBullet = false;
  for (const p of paras) {
    if (p.kind !== "para") continue;
    const isBullet = !!p.bullet;
    const piece = isBullet ? `${listMarker(p.bullet!)} ${p.text}` : isTable(p) ? tableMd(p.lines) : p.text;
    out += out ? (isBullet && prevBullet ? "\n" : "\n\n") + piece : piece;
    prevBullet = isBullet;
  }
  return out;
}

/**
 * Parse a table. Column positions come from the first data row that fills every column,
 * otherwise from the header line.
 * Rows are top-aligned: each cell belongs to the nearest row anchor at or above it, and an
 * anchor is any line holding the `anchorCol` cell (a column that is never blank or wrapped).
 * Fragments in the same cell are joined with spaces.
 */
export function parseTable(lines: Line[], nCols: number, anchorCol = 1, header?: Line, align: "top" | "nearest" = "top"): string[][] {
  // prefer a full data row (centred columns start left of their header); fall back to the header
  const full = lines.find((l) => l.cells.length === nCols) ?? (header?.cells.length === nCols ? header : undefined);
  if (!full) throw new Error(`table on p${lines[0]?.page}: no row with ${nCols} cells`);
  const colX = full.cells.map((c) => c[0]);
  const colOf = (x: number) => {
    let j = 0;
    for (let k = 0; k < colX.length; k++) if (colX[k] <= x + 5) j = k;
    return j;
  };
  // a line with one cell per column maps by order (centred columns shift per row); partial lines map by x
  const cellCols = (l: Line) => (l.cells.length === nCols ? l.cells.map((_, k) => k) : l.cells.map((c) => colOf(c[0])));
  if (anchorCol < 0) {
    // auto: the column with the fewest fragments never wraps (lowest index wins a tie)
    const frags = Array.from({ length: nCols }, (_, k) => lines.reduce((n, l) => n + cellCols(l).filter((j) => j === k).length, 0));
    const min = Math.min(...frags.filter((n) => n > 0));
    anchorCol = frags.indexOf(min);
  }
  const rows: { y: number; page: number; cells: string[][] }[] = [];
  const anchors = lines.filter((l) => cellCols(l).includes(anchorCol));
  for (const a of anchors) rows.push({ y: a.y, page: a.page, cells: Array.from({ length: nCols }, () => []) });
  for (const l of lines) {
    const row =
      align === "top"
        ? rows.filter((r) => r.page === l.page && r.y >= l.y - 0.5).sort((a, b) => a.y - b.y)[0]
        : rows.filter((r) => r.page === l.page).sort((a, b) => Math.abs(a.y - l.y) - Math.abs(b.y - l.y))[0];
    if (!row) throw new Error(`table on p${l.page}: text above first row: ${l.text}`);
    const cols = cellCols(l);
    l.cells.forEach(([, t], k) => row.cells[cols[k]].push(t));
  }
  return rows.map((r) => r.cells.map((parts) => joinLines(parts)));
}

/** A paragraph whose first line has several cells and that is set in the small table size. */
function isTable(p: Extract<Block, { kind: "para" }>): boolean {
  return p.lines[0].cells.length > 1 && !p.bullet && p.lines.length >= 2 && (p.lines[0].size <= 8.5 || p.lines.filter((l) => l.cells.length > 1).length >= 2);
}

/** Render table lines as a markdown table, first line as header. Falls back to one row per line. */
export function tableMd(lines: Line[]): string {
  const header = lines[0];
  const n = header.cells.length;
  let rows: string[][];
  try {
    rows = parseTable(lines.slice(1), n, -1, header);
  } catch {
    try {
      // some tables centre the first column against multi-line cells
      rows = parseTable(lines.slice(1), n, -1, header, "nearest");
    } catch {
      rows = lines.slice(1).map((l) => l.cells.map((c) => c[1]));
    }
  }
  const esc = (c: string) => c.replace(/\|/g, "\\|");
  const head = header.cells.map((c) => esc(plain(c[1]).trim()));
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => " --- |").join("")}`,
    ...rows.map((r) => `| ${Array.from({ length: n }, (_, k) => esc(r[k] ?? "")).join(" | ")} |`),
  ].join("\n");
}

/** Remove the first n lines from a run of paragraphs, re-joining any paragraph that was cut. */
export function dropLines(paras: Block[], n: number): Extract<Block, { kind: "para" }>[] {
  const out: Extract<Block, { kind: "para" }>[] = [];
  let left = n;
  for (const p of paras) {
    if (p.kind !== "para") continue;
    if (left >= p.lines.length) {
      left -= p.lines.length;
      continue;
    }
    if (left > 0) {
      const lines = p.lines.slice(left);
      out.push({ ...p, lines, page: lines[0].page, text: joinLines(lines.map((l) => l.text)), bullet: undefined });
      left = 0;
    } else out.push(p);
  }
  return out;
}
