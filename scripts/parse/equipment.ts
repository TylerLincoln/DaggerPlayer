// Weapons, combat wheelchairs and armor (SRD pp. 55–74).
import type { EntryOf, Feature } from "../../content/schema/index.ts";
import { type Line, pages, parseTable, plain, range, slug, toFeature, trait } from "./lines.ts";
import { src, PACK } from "./common.ts";

/** Split the lines of a page range into tables: a header line ("Name …") and the size-8 rows after it. */
function tables(lines: Line[]) {
  const out: { context: string[]; rows: Line[]; header: Line }[] = [];
  const context: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.heading && /^Name\b/.test(plain(l.cells[0][1]))) {
      // armor headers wrap ("Base / Thresholds"), so skip any further header lines
      while (lines[i + 1]?.heading && lines[i + 1].size === l.size) i++;
      const rows: Line[] = [];
      while (lines[i + 1] && !lines[i + 1].heading && lines[i + 1].size === 8) rows.push(lines[++i]);
      out.push({ context: [...context], rows, header: l });
    } else context.push(plain(l.text).trim());
  }
  return out;
}

const lastMatch = (ctx: string[], re: RegExp) => [...ctx].reverse().find((t) => re.test(t));

function feature(cell: string): Feature | null {
  if (/^(\*\*_?)?—(_?\*\*)?$/.test(cell.trim())) return null;
  const f = toFeature(cell);
  if (!f) throw new Error(`feature cell without a label: ${cell}`);
  return f;
}

function damage(cell: string) {
  const m = plain(cell).match(/^d(\d+)(?:\+(\d+))? (phy\/mag|phy|mag)$/);
  if (!m) throw new Error(`bad damage "${cell}"`);
  return { dice: `d${m[1]}`, bonus: Number(m[2] ?? 0), type: m[3] as "phy" | "mag" | "phy/mag" };
}

function burden(cell: string): 1 | 2 {
  const b = plain(cell).trim();
  if (b === "One-Handed") return 1;
  if (b === "Two-Handed") return 2;
  throw new Error(`bad burden "${cell}"`);
}

const weaponTrait = (cell: string) => (plain(cell).trim() === "Spellcast" ? ("spellcast" as const) : trait(cell));

export function parseEquipment(lines: Line[]) {
  const weapons: EntryOf<"weapon">[] = [];
  const armor: EntryOf<"armor">[] = [];

  for (const t of tables(pages(lines, 55, 74))) {
    const ctx = t.context;
    const section = lastMatch(ctx, /^(PRIMARY WEAPON TABLES|SECONDARY WEAPON TABLES|Combat Wheelchair|ARMOR TABLES)$/);
    const tierHead = lastMatch(ctx, /^TIER \d/);
    const headerCols = t.header.cells.map((c) => plain(c[1]).trim());

    if (section === "ARMOR TABLES") {
      const tier = Number(tierHead!.match(/\d/)![0]);
      for (const [name, th, score, feat] of parseTable(t.rows, 4)) {
        const m = plain(th).match(/^(\d+) \/ (\d+)$/);
        if (!m) throw new Error(`armor ${name}: bad thresholds ${th}`);
        const n = plain(name);
        armor.push({
          id: `${PACK}/armor/${slug(n)}`, type: "armor", name: n, pack: PACK, source: src(t.rows[0].page), tier,
          baseThresholds: { major: Number(m[1]), severe: Number(m[2]) }, baseScore: Number(plain(score)), feature: feature(feat),
        });
      }
      continue;
    }

    const wheelchair = section === "Combat Wheelchair";
    const nCols = wheelchair ? 7 : 6;
    if (headerCols.length !== nCols) throw new Error(`weapon table p${t.header.page}: header ${headerCols.join("|")}`);
    const category = section === "SECONDARY WEAPON TABLES" ? "secondary" : "primary";
    // only look for a group label inside the current section
    const sectionCtx = ctx.slice(ctx.lastIndexOf(section!));
    const groupLine = lastMatch(sectionCtx, /^(Physical Weapons|Magic Weapons|Light Frame Models|Heavy Frame Models|Arcane Frame Models)$/);

    for (const row of parseTable(t.rows, nCols, 1, t.header)) {
      const [name, ...rest] = row;
      const [tierCell, tr, rg, dmg, bd, feat] = wheelchair ? rest : [String(Number(tierHead!.match(/\d/)![0])), ...rest];
      const n = plain(name);
      const dmgParsed = damage(dmg);
      // secondary tables have no Physical/Magic split: magic damage marks a magic weapon
      const group = wheelchair ? "combat-wheelchair" : groupLine ? (groupLine === "Magic Weapons" ? "magic" : "physical") : dmgParsed.type === "mag" ? "magic" : "physical";
      weapons.push({
        id: `${PACK}/weapon/${slug(n)}`, type: "weapon", name: n, pack: PACK, source: src(t.rows[0].page),
        tier: Number(plain(tierCell)), category, group, trait: weaponTrait(tr), range: range(rg), damage: dmgParsed, burden: burden(bd), feature: feature(feat),
        ...(wheelchair ? { tags: [slug(groupLine ?? "")] } : {}),
      });
    }
  }
  return { weapons, armor };
}
