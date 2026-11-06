// Druid Beastform options (SRD pp. 15–17).
import type { EntryOf } from "../../content/schema/index.ts";
import { type Block, type Line, blocks, features, md, pages, plain, range, slug, titleCase, trait } from "./lines.ts";
import { src, PACK } from "./common.ts";

type Para = Extract<Block, { kind: "para" }>;

export function parseBeastforms(lines: Line[]) {
  const bs = blocks(pages(lines, 15, 18));
  const start = bs.findIndex((b) => b.kind === "heading" && b.text === "BEASTFORM OPTIONS");
  if (start === -1) throw new Error("BEASTFORM OPTIONS not found");
  const intro: Para[] = [];
  const out: EntryOf<"beastform">[] = [];
  let tier = 0;
  let i = start + 1;
  while (i < bs.length && bs[i].kind === "para") intro.push(bs[i++] as Para);
  for (; i < bs.length; i++) {
    const b = bs[i];
    if (b.kind !== "heading") continue;
    const t = b.text.match(/^TIER (\d)$/);
    if (t) {
      tier = Number(t[1]);
      continue;
    }
    if (b.level !== 3 || !tier) break; // next chapter
    const paras: Para[] = [];
    while (bs[i + 1]?.kind === "para") paras.push(bs[++i] as Para);
    const name = titleCase(b.text);
    // header lines: (examples) / Trait +n | Evasion +n / Range Trait dice type / Gain advantage on: …
    const head = paras.slice(0, 3).flatMap((p) => p.lines.map((l) => plain(l.text).trim()));
    const headText = head.join("\n");
    const hm = headText.match(/^\(([^)]*)\)\n(\w+) \+(\d+) \| Evasion \+(\d+)\n(Melee|Very Close|Close|Far|Very Far) (\w+) (\S+) (phy|mag)(?:\nGain advantage on: ([^\n]+(?:\n[a-z][^\n]*)*))?/);
    if (!hm) {
      // upgrade forms: "(Upgraded Tier 1 Options)" then features only
      const ex = head[0]?.match(/^\((.*)\)$/);
      if (!ex || !/Upgraded|Options/i.test(ex[1])) throw new Error(`beastform ${name}: unexpected header:\n${headText}`);
      let skipped = false;
      const featParas = paras.map((p, k) => (k === 0 && p.lines.length === 1 ? ((skipped = true), null) : p)).filter((p): p is Para => !!p);
      if (!skipped) throw new Error(`beastform ${name}: examples line not its own paragraph`);
      out.push({
        id: `${PACK}/beastform/${slug(name)}`, type: "beastform", name, pack: PACK, source: src(b.page), tier,
        examples: ex[1], traitBonus: null, evasionBonus: null, attack: null, advantages: [], features: features(featParas),
      });
      continue;
    }
    const used = hm[0].split("\n").length;
    // paragraphs after the header lines are the features
    let n = 0;
    const rest = paras.filter((p) => (n += p.lines.length) > used);
    const [, examples, tr, tv, ev, rg, atr, dmg, dtype, advs] = hm;
    out.push({
      id: `${PACK}/beastform/${slug(name)}`,
      type: "beastform",
      name,
      pack: PACK,
      source: src(b.page),
      tier,
      examples,
      traitBonus: { trait: trait(tr), value: Number(tv) },
      evasionBonus: Number(ev),
      attack: { range: range(rg), trait: trait(atr), damage: dmg, damageType: dtype as "phy" | "mag" },
      advantages: (advs ?? "").replace(/\n/g, " ").split(/,\s*/).map((s) => s.trim()).filter(Boolean),
      features: features(rest),
    });
  }
  return { beastforms: out, intro: md(intro), introPage: bs[start].page };
}
