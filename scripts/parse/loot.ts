// Loot: items (pp. 75–79) and consumables (pp. 80–84). Roll tables, sometimes two side by side.
import type { EntryOf } from "../../content/schema/index.ts";
import { type Line, pages, parseTable, plain, slug } from "./lines.ts";
import { src, PACK } from "./common.ts";

export function parseLoot(lines: Line[]) {
  const items: EntryOf<"item">[] = [];
  const consumables: EntryOf<"consumable">[] = [];
  const range = pages(lines, 75, 84);

  let kind = "item" as "item" | "consumable";
  let table = "";
  const headers: { line: Line; kind: typeof kind; table: string; rows: Line[] }[] = [];
  for (const l of range) {
    const t = plain(l.text).trim();
    if (l.heading && t === "ITEMS") kind = "item";
    else if (l.heading && t === "CONSUMABLES") kind = "consumable";
    else if (l.heading && t === "GOLD") break;
    else if (/^(Core Set|Additional) (Items|Consumables)$/.test(t)) table = t;
    else if (l.heading && /^ROLL\b/.test(plain(l.cells[0][1]))) headers.push({ line: l, kind, table, rows: [] });
    else if (l.size === 8 && !l.heading) {
      // nearest header above and to the left on the same page
      const h = headers
        .filter((h) => h.line.page === l.page && h.line.y > l.y && h.line.x <= l.x + 12)
        .sort((a, b) => b.line.x - a.line.x || a.line.y - b.line.y)[0];
      if (!h) throw new Error(`loot row without header p${l.page}: ${t}`);
      h.rows.push(l);
    }
  }

  for (const h of headers) {
    if (!h.rows.length) continue;
    for (const [roll, name, text] of parseTable(h.rows, 3, 0, h.line)) {
      const n = plain(name);
      const entry = {
        id: `${PACK}/${h.kind}/${slug(n)}`, name: n, pack: PACK, source: src(h.line.page),
        roll: Number(plain(roll)), table: h.table, text,
      };
      if (!Number.isInteger(entry.roll) || entry.roll < 1) throw new Error(`bad roll for ${n}: ${roll}`);
      if (h.kind === "item") items.push({ ...entry, type: "item" });
      else consumables.push({ ...entry, type: "consumable" });
    }
  }
  return { items, consumables };
}
