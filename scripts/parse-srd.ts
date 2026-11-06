// Parses the extracted SRD 2.0 text into content packs.
// Usage: npm run content:parse
//   in:  content/srd/raw/srd-2.0.lines.json, content/srd/errata.json, content/srd/glossary-terms.json
//   out: content/srd/data/*.json, content/srd/raw/sections/*.txt, content/srd-frames/data/*.json
import fs from "node:fs";
import path from "node:path";
import type { Entry, EntryOf, PackMeta } from "../content/schema/index.ts";
import { loadLines } from "./parse/lines.ts";
import { parseClasses, parseDomains } from "./parse/classes.ts";
import { parseHeritage } from "./parse/heritage.ts";
import { parseBeastforms } from "./parse/beastforms.ts";
import { parseDomainCards } from "./parse/domain-cards.ts";
import { parseEquipment } from "./parse/equipment.ts";
import { parseLoot } from "./parse/loot.ts";
import { parseAdversaries, parseEnvironments } from "./parse/gm.ts";
import { RulesBuilder, type Segment, bodyMd, parseCompanionOptions, parseConditions, parseProgression, segmentSections } from "./parse/rules.ts";
import { buildGlossary, autotag } from "./parse/glossary.ts";
import { applyModifiers } from "./parse/modifiers.ts";
import { FRAMES_PACK, PACK } from "./parse/common.ts";
import { loadErrata } from "./parse/errata.ts";

const ATTRIBUTION =
  "This product includes materials from the Daggerheart System Reference Document 2.0, © Critical Role, LLC. under the terms of the Darrington Press Community Gaming (DPCGL) License. More information can be found at https://www.daggerheart.com. There are no previous modifications by others.";

/** Rules text in book order. Entries parsed elsewhere are skipped or cut off with start/stop. */
const SRD_SEGMENTS: Segment[] = [
  { from: 3, to: 6 }, // introduction, character creation
  { from: 7, to: 9, skip: /^(ARCANA|BLADE|BONE|CODEX|DREAD|GRACE|MIDNIGHT|SAGE|SPLENDOR|VALOR)$/, stop: /^ASSASSIN$/ },
  { from: 12, to: 14, start: "MARTIAL STANCES", stop: /^DRUID$/ },
  { from: 15, to: 15, start: "BEASTFORM OPTIONS", stop: /^TIER 1$/ },
  { from: 20, to: 22, start: "RANGER COMPANION", stop: /^ROGUE$/ },
  // heritage chapter intros come from parseHeritage
  { from: 46, to: 54 }, // core mechanics … multiclassing
  { from: 55, to: 55, stopAtTable: true, stop: /^PRIMARY WEAPON TABLES$/ },
  { from: 70, to: 70, start: "COMBAT WHEELCHAIR", stopAtTable: true },
  { from: 72, to: 72, start: "ARMOR", stop: /^ARMOR TABLES$/ },
  { from: 75, to: 75, start: "LOOT", stopAtTable: true },
  { from: 80, to: 80, start: "CONSUMABLES", stopAtTable: true },
  { from: 84, to: 84, start: "GOLD" },
  { from: 85, to: 96, stop: /^ADVERSARIES BY TIER$/ },
  { from: 158, to: 159, start: "USING ENVIRONMENTS", stop: /^ENVIRONMENT STAT BLOCKS BY TIER$/, skip: /^(PERFECTED ZOMBIE|ZOMBIE LEGION)$/ },
  { from: 183, to: 184, start: "ADDITIONAL GM GUIDANCE", stop: /^The Witherwild$/i },
];

/** The optional pack (decision D3): Witherwild campaign frame + supplemental campaign mechanics. */
const FRAMES_SEGMENTS: Segment[] = [
  { from: 184, to: 189, start: "THE WITHERWILD" },
  { from: 190, to: 205 },
];

function main() {
  const lines = loadLines();

  // ---- entries ----
  const domains = parseDomains(lines);
  // domain icons extracted by scripts/extract-icons.ts (Public Game Content, DPCGL 2.0 §1.6)
  for (const d of domains) {
    const icon = `icons/${d.id.split("/").pop()}.png`;
    if (fs.existsSync(path.join("content/srd", icon))) d.icon = icon;
    else console.warn(`no icon for ${d.name} (run npm run content:icons)`);
  }
  const { classes, subclasses } = parseClasses(lines);
  const heritage = parseHeritage(lines);
  const { beastforms } = parseBeastforms(lines);
  const cards = parseDomainCards(lines);
  const { weapons, armor } = parseEquipment(lines);
  const { items, consumables } = parseLoot(lines);
  const adversaries = parseAdversaries(lines);
  const environments = parseEnvironments(lines);
  const conditions = parseConditions(lines);
  const progression = parseProgression(lines, parseCompanionOptions(lines));

  // ---- rules ----
  const rules = new RulesBuilder(PACK);
  for (const seg of SRD_SEGMENTS) {
    rules.addSections(segmentSections(lines, seg));
    if (seg.from === 20) {
      // heritage chapters follow the class chapter in the book
      for (const r of heritage.rules) rules.add(r.title, r.level, r.page, r.page, r.text);
    }
  }
  const frames = new RulesBuilder(FRAMES_PACK);
  for (const seg of FRAMES_SEGMENTS) frames.addSections(segmentSections(lines, seg));
  for (const e of frames.entries) e.source = { kind: "srd", document: "Daggerheart SRD 2.0", page: e.source.page, ...(e.source.pageEnd ? { pageEnd: e.source.pageEnd } : {}) };

  // ---- glossary + term tagging ----
  const glossary = buildGlossary(rules.entries, conditions);
  const srdEntries: Entry[] = [
    ...domains, ...classes, ...subclasses, ...heritage.ancestries, ...heritage.communities, ...heritage.transformations,
    ...beastforms, ...cards, ...weapons, ...armor, ...items, ...consumables, ...adversaries, ...environments,
    progression, ...conditions, ...glossary, ...rules.entries,
  ];
  const modCount = applyModifiers(srdEntries);
  const tagStats = autotag([...srdEntries, ...frames.entries], glossary);

  // ---- write ----
  const errata = loadErrata();
  const srdMeta: PackMeta = {
    id: PACK, name: "Daggerheart SRD 2.0", version: "2.0.0", kind: "srd", defaultEnabled: true, requires: [],
    attribution: ATTRIBUTION,
    modifications: [
      "Reformatted into structured data (JSON) by DaggerPlayer; rules terms are linked.",
      `Corrected ${errata.length} typesetting issue(s); each is listed in errata.json.`,
      "Text is otherwise unchanged.",
    ],
  };
  const framesMeta: PackMeta = {
    id: FRAMES_PACK, name: "SRD 2.0 Campaign Frames & Supplemental Mechanics", version: "2.0.0", kind: "srd", defaultEnabled: false,
    requires: [PACK], attribution: ATTRIBUTION, modifications: srdMeta.modifications,
  };
  writePack("content/srd", srdMeta, srdEntries);
  writePack("content/srd-frames", framesMeta, frames.entries);
  writeRawSections("content/srd", srdEntries);

  const count: Record<string, number> = {};
  for (const e of srdEntries) count[e.type] = (count[e.type] ?? 0) + 1;
  console.log("srd:", count);
  console.log("srd-frames:", frames.entries.length, "rules sections");
  console.log("entries with modifiers:", modCount);
  console.log("term tags:", Object.values(tagStats).reduce((a, b) => a + b, 0));
}

function writePack(dir: string, meta: PackMeta, entries: Entry[]) {
  const data = path.join(dir, "data");
  fs.rmSync(data, { recursive: true, force: true });
  fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(dir, "pack.json"), JSON.stringify(meta, null, 2) + "\n");
  const byType = new Map<string, Entry[]>();
  for (const e of entries) byType.set(e.type, [...(byType.get(e.type) ?? []), e]);
  for (const [type, list] of byType) fs.writeFileSync(path.join(data, `${type}.json`), JSON.stringify(list, null, 2) + "\n");
}

/** Raw text of the pages each content type came from, next to the parsed data for side-by-side checks. */
function writeRawSections(dir: string, entries: Entry[]) {
  const txt = fs.readFileSync(path.join(dir, "raw/srd-2.0.txt"), "utf8");
  const pagesText = txt.split(/^@@PDFPAGE (\d+)@@\n/m);
  const pageMap = new Map<number, string>();
  for (let i = 1; i < pagesText.length; i += 2) pageMap.set(Number(pagesText[i]), pagesText[i + 1]);
  const out = path.join(dir, "raw/sections");
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const byType = new Map<string, Set<number>>();
  for (const e of entries) {
    const set = byType.get(e.type) ?? new Set<number>();
    const { page, pageEnd } = e.source;
    if (page) for (let p = page; p <= (pageEnd ?? page); p++) set.add(p);
    byType.set(e.type, set);
  }
  for (const [type, set] of byType) {
    const body = [...set].sort((a, b) => a - b).map((p) => `@@PDFPAGE ${p}@@\n${pageMap.get(p) ?? ""}`).join("");
    fs.writeFileSync(path.join(out, `${type}.txt`), body);
  }
}

export { bodyMd };
main();
