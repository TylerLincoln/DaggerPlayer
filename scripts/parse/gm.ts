// Adversaries (pp. 93–158) and environments (pp. 159–182).
import { ADVERSARY_TYPES, type EntryOf, type Feature } from "../../content/schema/index.ts";
import { type Block, type Line, blocks, features, md, pages, plain, range, slug, titleCase } from "./lines.ts";
import { src, PACK } from "./common.ts";

type Para = Extract<Block, { kind: "para" }>;

interface StatBlock {
  name: string;
  page: number;
  lastPage: number;
  tierLine: string;
  head: Para[]; // description and stat lines
  body: Para[]; // after FEATURES
}

/** Stat blocks: a level-2 heading followed by a "Tier N …" line. */
function statBlocks(bs: Block[]): StatBlock[] {
  const out: StatBlock[] = [];
  let cur: StatBlock | null = null;
  let inFeatures = false;
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.kind === "heading") {
      const next = bs[i + 1];
      if (b.level === 2 && next?.kind === "para" && /^Tier \d/.test(plain(next.text))) {
        cur = { name: b.text, page: b.page, lastPage: b.page, tierLine: "", head: [], body: [] };
        out.push(cur);
        inFeatures = false;
      } else if (cur && b.text === "FEATURES") inFeatures = true;
      else cur = null; // a chapter or tier heading ends the block
      continue;
    }
    if (!cur) continue;
    // the Tier line can share a paragraph with the description; split on lines
    if (!cur.tierLine) {
      cur.tierLine = plain(b.lines[0].text).trim();
      if (b.lines.length > 1) cur.head.push({ ...b, lines: b.lines.slice(1), text: b.lines.slice(1).map((l) => l.text).join(" ") });
      continue;
    }
    (inFeatures ? cur.body : cur.head).push(b);
    cur.lastPage = b.page;
  }
  return out;
}

/** The italic description, then "Label: value" lines. Returns description text and a label map. */
function headFields(head: Para[]) {
  const desc: string[] = [];
  const fields: Record<string, string> = {};
  // re-split on lines: stat labels each start a line
  const lines = head.flatMap((p) => p.lines);
  let curLabel: string | null = null;
  for (const l of lines) {
    const t = plain(l.text).replace(/\s+/g, " ").trim();
    const m = t.match(/^(Motives & Tactics|Impulses|Difficulty|ATK|Experiences?|Potential Adversaries):\s*(.*)$/);
    if (m) {
      curLabel = m[1];
      fields[curLabel] = m[2];
    } else if (curLabel) fields[curLabel] += " " + t;
    else desc.push(l.text);
  }
  return { desc: desc.join(" ").trim(), fields };
}

function withQuestions(body: Para[]): Feature[] {
  // environment features end with italic GM questions set in a smaller size
  const feats: Para[] = [];
  const qs: { after: number; text: string }[] = [];
  for (const p of body) {
    if (p.lines.every((l) => l.size <= 7.5)) qs.push({ after: feats.length, text: plain(p.text).trim() });
    else feats.push(p);
  }
  const fs = features(feats);
  // map question paragraphs to the feature they follow (count features up to that paragraph)
  let fi = -1;
  let seen = 0;
  const featIndexAt: number[] = [];
  for (const p of feats) {
    if (!p.bullet && /^\*\*/.test(p.text) && fs[fi + 1] && plain(p.text).startsWith(fs[fi + 1].name)) fi++;
    featIndexAt[seen++] = fi;
  }
  for (const q of qs) {
    const f = fs[featIndexAt[q.after - 1] ?? 0];
    (f.questions ??= []).push(q.text);
  }
  return fs;
}

export function parseAdversaries(lines: Line[]): EntryOf<"adversary">[] {
  const out: EntryOf<"adversary">[] = [];
  for (const s of statBlocks(blocks(pages(lines, 93, 158)))) {
    const name = titleCase(s.name);
    const tm = s.tierLine.match(/^Tier (\d) (\w+)(?: \((\d+)\/HP\))?$/);
    if (!tm) throw new Error(`${name}: bad tier line "${s.tierLine}"`);
    const role = tm[2].toLowerCase() as (typeof ADVERSARY_TYPES)[number];
    if (!ADVERSARY_TYPES.includes(role)) throw new Error(`${name}: unknown type ${tm[2]}`);
    const { desc, fields } = headFields(s.head);
    const st = (fields.Difficulty ?? "").match(/^(\d+) \| Thresholds: (None|(\d+|None)\/(\d+|None)) \| HP: (\d+|None) \| Stress: (\d+|None)$/);
    if (!st) throw new Error(`${name}: bad stat line "Difficulty: ${fields.Difficulty}"`);
    const at = (fields.ATK ?? "").match(/^([+−–-]\d*(?:d\d+)?) \| (.+?): (Melee|Very Close|Close|Far|Very Far) \| (.+)$/);
    if (!at) throw new Error(`${name}: bad attack line "ATK: ${fields.ATK}"`);
    const xp = fields.Experience ?? fields.Experiences;
    out.push({
      id: `${PACK}/adversary/${slug(name)}`,
      type: "adversary",
      name,
      pack: PACK,
      source: src(s.page, s.lastPage),
      tier: Number(tm[1]),
      role,
      ...(tm[3] ? { hordePerHp: Number(tm[3]) } : {}),
      text: desc,
      motives: fields["Motives & Tactics"] ?? "",
      difficulty: Number(st[1]),
      thresholds: st[2] === "None" ? null : { major: st[3] === "None" ? null : Number(st[3]), severe: st[4] === "None" ? null : Number(st[4]) },
      hp: st[5] === "None" ? null : Number(st[5]),
      stress: st[6] === "None" ? null : Number(st[6]),
      attack: { modifier: at[1].replace(/[−–]/, "-"), name: at[2], range: range(at[3]), damage: at[4] },
      experiences: xp
        ? xp.split(/,\s*/).map((e) => {
            const m = e.match(/^(.+?) ([+−–-]\d+)$/);
            if (!m) throw new Error(`${name}: bad experience "${e}"`);
            return { name: m[1], bonus: Number(m[2].replace(/[−–]/, "-")) };
          })
        : [],
      features: features(s.body),
    });
  }
  return out;
}

export function parseEnvironments(lines: Line[]): EntryOf<"environment">[] {
  const out: EntryOf<"environment">[] = [];
  for (const s of statBlocks(blocks(pages(lines, 159, 182)))) {
    const name = titleCase(s.name);
    const tm = s.tierLine.match(/^Tier (\d) (Exploration|Social|Traversal|Event)$/);
    if (!tm) throw new Error(`${name}: bad tier line "${s.tierLine}"`);
    const { desc, fields } = headFields(s.head);
    const dm = (fields.Difficulty ?? "").match(/^(\d+)?\s*(.*)$/)!;
    out.push({
      id: `${PACK}/environment/${slug(name)}`,
      type: "environment",
      name,
      pack: PACK,
      source: src(s.page, s.lastPage),
      tier: Number(tm[1]),
      envType: tm[2].toLowerCase() as "exploration",
      text: desc,
      impulses: fields.Impulses ?? "",
      difficulty: dm[1] ? Number(dm[1]) : null,
      ...(dm[2] ? { difficultyNote: dm[2] } : {}),
      potentialAdversaries: fields["Potential Adversaries"] ?? "",
      features: withQuestions(s.body),
    });
  }
  return out;
}
