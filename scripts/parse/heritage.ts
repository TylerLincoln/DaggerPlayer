// Ancestries (pp. 32–37), communities (pp. 38–42) and transformations (pp. 42–45).
import type { EntryOf } from "../../content/schema/index.ts";
import { type Block, type Line, blocks, features, md, pages, plain, slug, titleCase } from "./lines.ts";
import { src, PACK } from "./common.ts";

type Para = Extract<Block, { kind: "para" }>;
type Heading = Extract<Block, { kind: "heading" }>;

interface Section {
  heading: Heading;
  intro: Para[];
  parts: { heading: Heading; paras: Para[] }[];
  lastPage: number;
}

/** Split blocks into level-2 sections, each with intro paragraphs and level-3 sub-parts. */
function sections(bs: Block[]): Section[] {
  const out: Section[] = [];
  let cur: Section | null = null;
  for (const b of bs) {
    if (b.kind === "heading" && b.level <= 2) {
      cur = { heading: b, intro: [], parts: [], lastPage: b.page };
      out.push(cur);
    } else if (!cur) continue;
    else if (b.kind === "heading") cur.parts.push({ heading: b, paras: [] });
    else {
      (cur.parts.length ? cur.parts[cur.parts.length - 1].paras : cur.intro).push(b);
      cur.lastPage = b.page;
    }
  }
  return out;
}

const join = md;

export function parseHeritage(lines: Line[]) {
  const ancestries: EntryOf<"ancestry">[] = [];
  const communities: EntryOf<"community">[] = [];
  const transformations: EntryOf<"transformation">[] = [];
  /** text sections that become rules entries (ancestry intro, elemental kin, mixed ancestry, …) */
  const rules: { title: string; page: number; text: string; level: number }[] = [];

  let group: string | undefined;
  for (const s of sections(blocks(pages(lines, 32, 45)))) {
    const title = s.heading.text;
    const name = titleCase(title);
    const feats = s.parts.find((p) => /FEATURES?$/.test(p.heading.text));
    const kind = feats?.heading.text.split(" ")[0];
    const source = src(s.heading.page, s.lastPage);

    if (!feats) {
      // prose-only section: a chapter intro or a group like Elemental Kin
      const body = [join(s.intro), ...s.parts.map((p) => `### ${titleCase(p.heading.text)}\n\n${join(p.paras)}`)].filter(Boolean).join("\n\n");
      rules.push({ title: name, page: s.heading.page, text: body, level: s.heading.level });
      group = title === "ELEMENTAL KIN" ? "elemental-kin" : undefined;
      continue;
    }
    const fs = features(feats.paras);
    const text = join(s.intro);

    if (kind === "ANCESTRY") {
      if (fs.length !== 2) throw new Error(`${name}: ${fs.length} ancestry features`);
      ancestries.push({
        id: `${PACK}/ancestry/${slug(name)}`, type: "ancestry", name, pack: PACK, source, text,
        features: [fs[0], fs[1]],
        ...(group && /kin$/i.test(name) ? { tags: [group] } : {}),
      });
    } else if (kind === "COMMUNITY") {
      // the last intro paragraph lists adjectives: "Duneborne are often candid, …, and weathered."
      const last = plain(s.intro[s.intro.length - 1]?.text ?? "");
      const m = last.match(/are often (.+)\.$/);
      if (fs.length !== 1) throw new Error(`${name}: ${fs.length} community features`);
      communities.push({
        id: `${PACK}/community/${slug(name)}`, type: "community", name, pack: PACK, source, text,
        adjectives: m ? m[1].replace(/,? and /, ", ").split(/,\s*/).map((a) => a.trim()) : [],
        feature: fs[0],
      });
    } else if (kind === "TRANSFORMATION") {
      const q = s.parts.find((p) => p.heading.text === "TRANSFORMATION QUESTIONS");
      transformations.push({
        id: `${PACK}/transformation/${slug(name)}`, type: "transformation", name, pack: PACK, source, text,
        features: fs,
        questions: (q?.paras ?? []).filter((p) => p.bullet).map((p) => p.text),
      });
    } else throw new Error(`unknown heritage section ${title}`);
    if (kind !== "ANCESTRY") group = undefined;
  }
  return { ancestries, communities, transformations, rules };
}
