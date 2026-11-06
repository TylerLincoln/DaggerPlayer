// Rules text → rules sections (a tree), conditions, progression and glossary terms.
import type { EntryOf, Feature } from "../../content/schema/index.ts";
import { type Block, type Line, blocks, features, md, pages, plain, slug, titleCase } from "./lines.ts";
import { src, PACK } from "./common.ts";

type Para = Extract<Block, { kind: "para" }>;
type Heading = Extract<Block, { kind: "heading" }>;

export interface Segment {
  from: number;
  to: number;
  /** start at this heading (exact, upper-cased plain text) */
  start?: string;
  /** stop before this heading */
  stop?: RegExp;
  /** skip level ≤2 sections whose heading matches (content parsed elsewhere) */
  skip?: RegExp;
  /** stop at the first table (rows parsed elsewhere) */
  stopAtTable?: boolean;
}

export interface RawSection {
  title: string;
  level: number;
  page: number;
  lastPage: number;
  body: Block[];
}

/** Collect level 1–2 sections from a segment. Level 3+ headings stay inside the body. */
export function segmentSections(lines: Line[], seg: Segment): RawSection[] {
  let bs = blocks(pages(lines, seg.from, seg.to));
  if (seg.start) {
    const i = bs.findIndex((b) => b.kind === "heading" && b.text.toUpperCase() === seg.start);
    if (i === -1) throw new Error(`segment p${seg.from}: start heading ${seg.start} not found`);
    bs = bs.slice(i);
  }
  if (seg.stop) {
    const i = bs.findIndex((b, k) => k > 0 && b.kind === "heading" && seg.stop!.test(b.text));
    if (i !== -1) bs = bs.slice(0, i);
  }
  if (seg.stopAtTable) {
    const i = bs.findIndex((b) => b.kind === "para" && b.lines[0].cells.length > 1 && !b.bullet && b.lines[0].size <= 8);
    if (i !== -1) bs = bs.slice(0, i);
  }
  const out: RawSection[] = [];
  let skipping = false;
  for (const b of bs) {
    if (b.kind === "heading" && b.level <= 2) {
      skipping = !!seg.skip?.test(b.text);
      if (!skipping) out.push({ title: b.text, level: b.level, page: b.page, lastPage: b.page, body: [] });
      continue;
    }
    if (skipping) continue;
    if (!out.length) out.push({ title: "", level: 2, page: b.page, lastPage: b.page, body: [] });
    const cur = out[out.length - 1];
    cur.body.push(b);
    cur.lastPage = b.page;
  }
  return out;
}

/** Body blocks → markdown, level-3+ headings as ### / ####. */
export function bodyMd(body: Block[]): string {
  const parts: string[] = [];
  let run: Block[] = [];
  const flush = () => {
    if (run.length) parts.push(md(run));
    run = [];
  };
  for (const b of body) {
    if (b.kind === "heading") {
      flush();
      parts.push(`${"#".repeat(Math.min(b.level, 4))} ${titleCase(b.text)}`);
    } else run.push(b);
  }
  flush();
  return parts.join("\n\n");
}

/** Builds rules entries with unique ids and parent links. */
export class RulesBuilder {
  entries: EntryOf<"rules">[] = [];
  private order = 0;
  /** last entry id seen at heading level 0 (chapter) and 1 (section) */
  private last: [string | null, string | null] = [null, null];

  constructor(private pack = PACK) {}

  add(title: string, level: number, page: number, lastPage: number, text: string, parentId?: string | null): EntryOf<"rules"> {
    const name = titleCase(title);
    let base = `${this.pack}/rules/${slug(name)}`;
    const parent = parentId !== undefined ? parentId : level <= 0 ? null : level === 1 ? this.last[0] : (this.last[1] ?? this.last[0]);
    if (this.entries.some((e) => e.id === base)) base = `${this.pack}/rules/${slug((parent?.split("/").pop() ?? "") + "-" + name)}`;
    let id = base;
    for (let n = 2; this.entries.some((e) => e.id === id); n++) id = `${base}-${n}`;
    const e: EntryOf<"rules"> = {
      id, type: "rules", name, pack: this.pack,
      source: { kind: "srd", document: "Daggerheart SRD 2.0", page, ...(lastPage !== page ? { pageEnd: lastPage } : {}) },
      parentId: parent, order: this.order++, text,
    };
    this.entries.push(e);
    if (level <= 0) this.last = [id, null];
    else if (level === 1) this.last[1] = id;
    return e;
  }

  addSections(secs: RawSection[]) {
    for (const s of secs) {
      if (!s.title) {
        // text before the first heading continues the previous section
        const prev = this.entries[this.entries.length - 1];
        if (!prev) throw new Error(`untitled text on p${s.page}`);
        prev.text = [prev.text, bodyMd(s.body)].filter(Boolean).join("\n\n");
        continue;
      }
      this.add(s.title, s.level, s.page, s.lastPage, bodyMd(s.body));
    }
  }
}

// ---------- conditions ----------

export function parseConditions(lines: Line[]): EntryOf<"condition">[] {
  const bs = blocks(pages(lines, 52, 52));
  const out: EntryOf<"condition">[] = [];
  for (const name of ["HIDDEN", "RESTRAINED", "VULNERABLE"]) {
    const i = bs.findIndex((b) => b.kind === "heading" && b.text === name);
    if (i === -1) throw new Error(`condition ${name} not found`);
    const paras: Para[] = [];
    // only the first paragraph defines the condition; the rest of the section is general
    if (bs[i + 1]?.kind === "para") paras.push(bs[i + 1] as Para);
    const n = titleCase(name);
    out.push({ id: `${PACK}/condition/${slug(n)}`, type: "condition", name: n, pack: PACK, source: src(bs[i].page), text: md(paras) });
  }
  return out;
}

// ---------- progression ----------

const ADVANCEMENT_IDS: [RegExp, string, 1 | 2, number?][] = [
  [/increase two unmarked character traits/, "traits", 1],
  [/Hit Point slots/, "hp", 1],
  [/Stress slots/, "stress", 1],
  [/increase your Experience/, "experiences", 1],
  [/additional domain card/, "domain-card", 1],
  [/increase your Evasion/, "evasion", 1],
  [/upgraded subclass card/, "subclass", 1],
  [/increase your Proficiency/, "proficiency", 2],
  [/multiclass/, "multiclass", 2, 5],
];

export function parseProgression(lines: Line[], companion: Feature[]): EntryOf<"progression"> {
  const bs = blocks(pages(lines, 53, 54));
  const at = (t: string) => bs.findIndex((b) => b.kind === "heading" && b.text === t);
  const paras = (from: number) => {
    const out: Para[] = [];
    for (let i = from + 1; bs[i]?.kind === "para"; i++) out.push(bs[i] as Para);
    return out;
  };
  const achievements = paras(at("STEP ONE TIER ACHIEVEMENTS")).filter((p) => p.bullet);
  const tierAch = (level: number) => {
    const p = achievements.find((a) => plain(a.text).startsWith(`At level ${level},`));
    if (!p) throw new Error(`tier achievement for level ${level} not found`);
    return p.text;
  };
  const advParas = paras(at("STEP TWO ADVANCEMENTS")).filter((p) => p.bullet);
  const advancements = advParas.map((p) => {
    const t = plain(p.text);
    const hit = ADVANCEMENT_IDS.find(([re]) => re.test(t.split(":")[0]));
    if (!hit) throw new Error(`unknown advancement: ${t.slice(0, 60)}`);
    // Slot counts per tier are printed on the class character sheets, not in SRD 2.0 (p. 54).
    // Left null until the owner decides (see PROGRESS.md rules questions).
    return { id: hit[1], text: p.text, slots: null, cost: hit[2], ...(hit[3] ? { minLevel: hit[3] } : {}) };
  });
  if (advancements.length !== ADVANCEMENT_IDS.length) throw new Error(`expected ${ADVANCEMENT_IDS.length} advancements, got ${advancements.length}`);
  const intro = bs.findIndex((b) => b.kind === "heading" && b.text === "LEVELING UP");
  return {
    id: `${PACK}/progression/leveling`,
    type: "progression",
    name: "Leveling Up",
    pack: PACK,
    source: src(53, 54),
    tiers: [
      { tier: 1, levels: [1], achievements: null },
      { tier: 2, levels: [2, 3, 4], achievements: tierAch(2) },
      { tier: 3, levels: [5, 6, 7], achievements: tierAch(5) },
      { tier: 4, levels: [8, 9, 10], achievements: tierAch(8) },
    ],
    advancements,
    companionOptions: companion,
    text: md(paras(intro)),
  };
}

/** Ranger companion level-up options: the bullets under "LEVELING UP YOUR COMPANION". */
export function parseCompanionOptions(lines: Line[]): Feature[] {
  const bs = blocks(pages(lines, 20, 22));
  const i = bs.findIndex((b) => b.kind === "heading" && /^LEVELING UP YOUR COMPANION$/.test(b.text));
  if (i === -1) throw new Error("companion level-up section not found");
  const bullets: Para[] = [];
  for (let k = i + 1; k < bs.length && bs[k].kind === "para"; k++) if ((bs[k] as Para).bullet) bullets.push({ ...(bs[k] as Para), bullet: undefined });
  const fs = features(bullets);
  if (fs.length !== 8) throw new Error(`expected 8 companion options, got ${fs.length}`);
  return fs;
}

export type { Heading };
