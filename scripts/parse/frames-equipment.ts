// Equipment from the supplemental campaign mechanics (srd-frames pack): Everyday Hero starting
// equipment (pp. 191–192, Tier 1), Western weapons (p. 197) and Monster Hunting weapons (p. 201).
// Western/Monster Hunting weapons list damage per tier in one row; each tier becomes its own entry
// ("Revolver (Tier 2)") so tier limits and damage rolls work like any other weapon.
import type { EntryOf, Feature } from "../../content/schema/index.ts";
import { type Line, pages, parseTable, plain, range, slug, toFeature, trait } from "./lines.ts";
import { tables } from "./equipment.ts";
import { FRAMES_PACK, src } from "./common.ts";

const SECTIONS = [
  { from: 191, to: 192, tag: "everyday-hero" },
  { from: 197, to: 197, tag: "western" },
  { from: 201, to: 201, tag: "monster-hunting" },
];

function feature(cell: string): Feature | null {
  const t = plain(cell).trim();
  if (!t || /^—$/.test(t)) return null;
  const f = toFeature(cell);
  if (f) return f;
  // the Everyday Hero armor table doesn't bold its feature names: "Flexible: +1 to Evasion"
  const m = t.match(/^([^:]{1,40}):\s*(.+)$/s);
  if (!m) throw new Error(`frames equipment: feature without a name: ${t}`);
  return { name: m[1].trim(), text: m[2].trim() };
}

const burden = (cell: string): 1 | 2 => {
  const b = plain(cell).trim();
  if (b === "One-Handed") return 1;
  if (b === "Two-Handed") return 2;
  throw new Error(`frames equipment: bad burden "${cell}"`);
};

export function parseFramesEquipment(lines: Line[]) {
  const weapons: EntryOf<"weapon">[] = [];
  const armor: EntryOf<"armor">[] = [];
  for (const sec of SECTIONS) {
    for (const t of tables(pages(lines, sec.from, sec.to))) {
      const label = [...t.context].reverse().find((x) => /^(Primary|Secondary) (Physical |Magic )?Weapons$|^Armor$/.test(x)) ?? "";
      const page = t.rows[0]?.page ?? sec.from;
      if (label === "Armor") {
        for (const [name, th, score, feat = ""] of parseTable(t.rows, 4, 0, t.header)) {
          const n = plain(name);
          // Monster Hunting armor lists thresholds and score per tier: "Tier 1: 4/10 Tier 2: 6/15 …"
          const tiersTh = [...plain(th).matchAll(/Tier (\d): (\d+) ?\/ ?(\d+)/g)];
          const tiersSc = [...plain(score).matchAll(/Tier (\d): (\d+)/g)];
          const rows = tiersTh.length
            ? tiersTh.map((x) => ({ tier: Number(x[1]), major: Number(x[2]), severe: Number(x[3]), score: Number(tiersSc.find((y) => y[1] === x[1])?.[2] ?? NaN) }))
            : [(() => { const m = plain(th).match(/^(\d+) \/ (\d+)$/); if (!m) throw new Error(`frames armor ${n}: bad thresholds ${th}`); return { tier: 1, major: Number(m[1]), severe: Number(m[2]), score: Number(plain(score)) }; })()];
          for (const r of rows) {
            if (Number.isNaN(r.score)) throw new Error(`frames armor ${n}: no score for tier ${r.tier}`);
            const tiered = tiersTh.length > 0;
            armor.push({
              id: `${FRAMES_PACK}/armor/${slug(n)}${tiered ? `-tier-${r.tier}` : ""}`, type: "armor", name: tiered ? `${n} (Tier ${r.tier})` : n, pack: FRAMES_PACK, source: src(page),
              tier: r.tier, tags: [sec.tag], baseThresholds: { major: r.major, severe: r.severe }, baseScore: r.score, feature: feature(feat),
            });
          }
        }
        continue;
      }
      if (!label) throw new Error(`frames equipment p${page}: table without a label`);
      const category = label.startsWith("Secondary") ? "secondary" : "primary";
      for (const [name, tr, rg, dmg, bd, feat = ""] of parseTable(t.rows, 6, 1, t.header)) {
        const n = plain(name);
        const tiers = [...plain(dmg).matchAll(/Tier (\d): d(\d+)(?:\+(\d+))? (phy|mag)/g)];
        const rows = tiers.length
          ? tiers.map((x) => ({ tier: Number(x[1]), dice: `d${x[2]}`, bonus: Number(x[3] ?? 0), type: x[4] as "phy" | "mag" }))
          : [(() => { const m = plain(dmg).match(/^d(\d+)(?:\+(\d+))? (phy|mag)$/); if (!m) throw new Error(`frames weapon ${n}: bad damage ${dmg}`); return { tier: 1, dice: `d${m[1]}`, bonus: Number(m[2] ?? 0), type: m[3] as "phy" | "mag" }; })()];
        for (const r of rows) {
          const tiered = tiers.length > 0;
          weapons.push({
            id: `${FRAMES_PACK}/weapon/${slug(n)}${tiered ? `-tier-${r.tier}` : ""}`,
            type: "weapon", name: tiered ? `${n} (Tier ${r.tier})` : n, pack: FRAMES_PACK, source: src(page), tags: [sec.tag],
            tier: r.tier, category, group: label.includes("Magic") || r.type === "mag" ? "magic" : "physical",
            trait: trait(tr), range: range(rg), damage: { dice: r.dice, bonus: r.bonus, type: r.type }, burden: burden(bd), feature: feature(feat),
          });
        }
      }
    }
  }
  return { weapons, armor };
}
