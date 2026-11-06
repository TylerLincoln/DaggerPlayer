// Domain cards (SRD appendix, pp. 206–224).
import type { EntryOf } from "../../content/schema/index.ts";
import { type Block, type Line, blocks, dropLines, features, md, pages, plain, slug, titleCase } from "./lines.ts";
import { src, PACK } from "./common.ts";

type Para = Extract<Block, { kind: "para" }>;

export function parseDomainCards(lines: Line[]): EntryOf<"domain-card">[] {
  const bs = blocks(pages(lines, 206, 224));
  const out: EntryOf<"domain-card">[] = [];
  let domain = "";
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.kind !== "heading") continue;
    const d = b.text.match(/^(\w+) DOMAIN$/);
    if (d) {
      domain = d[1];
      continue;
    }
    if (b.level !== 3 || !domain) continue;
    const paras: Para[] = [];
    while (bs[i + 1]?.kind === "para") paras.push(bs[++i] as Para);
    const name = titleCase(b.text);
    // the level line and recall line may share a paragraph
    const headLines = paras.slice(0, 2).flatMap((p) => p.lines.map((l) => plain(l.text).trim()));
    const lm = headLines[0]?.match(/^Level (\d+) (\w+) (Ability|Spell|Grimoire)$/);
    const rm = headLines[1]?.match(/^Recall Cost: (\d+)$/);
    if (!lm || !rm) throw new Error(`card ${name}: bad header ${headLines.slice(0, 2).join(" / ")}`);
    if (lm[2].toUpperCase() !== domain) throw new Error(`card ${name}: domain ${lm[2]} under ${domain}`);
    const body = dropLines(paras, 2);
    const cardType = lm[3].toLowerCase() as "ability" | "spell" | "grimoire";
    const domainId = `${PACK}/domain/${slug(domain)}`;
    out.push({
      id: `${PACK}/domain-card/${slug(name)}`,
      type: "domain-card",
      name,
      pack: PACK,
      source: src(b.page, body[body.length - 1]?.page),
      domainId,
      level: Number(lm[1]),
      cardType,
      recallCost: Number(rm[1]),
      text: cardType === "grimoire" ? "" : md(body),
      ...(cardType === "grimoire" ? { features: features(body) } : {}),
    });
  }
  return out;
}
