// Summarises how two copies of the same character differ, for the "changed on two devices" screen.
import type { CharacterDoc } from "./character.ts";
import { derive, type Lookup } from "./derive.ts";

export interface Difference {
  label: string;
  mine: string;
  theirs: string;
}

export function compareCharacters(mine: CharacterDoc, theirs: CharacterDoc, lookup: Lookup): Difference[] {
  const a = derive(mine, lookup);
  const b = derive(theirs, lookup);
  const name = (id: string | null) => (id ? lookup.get(id)?.name ?? id : "—");
  const out: Difference[] = [];
  const cmp = (label: string, x: unknown, y: unknown, fmt: (v: never) => string = String) => {
    const [sx, sy] = [fmt(x as never), fmt(y as never)];
    if (sx !== sy) out.push({ label, mine: sx, theirs: sy });
  };
  const list = (ids: string[]) => ids.map(name).join(", ") || "—";
  const items = (c: CharacterDoc) => c.state.inventory.map((i) => `${i.name}${i.qty !== 1 ? ` ×${i.qty}` : ""}`).join(", ") || "—";
  const gold = (c: CharacterDoc) => `${c.state.gold.handfuls} handfuls, ${c.state.gold.bags} bags, ${c.state.gold.chests} chests`;

  cmp("Name", mine.identity.name, theirs.identity.name);
  cmp("Level", a.level, b.level);
  cmp("Class", `${name(mine.build.subclassId)} ${name(mine.build.classId)}`, `${name(theirs.build.subclassId)} ${name(theirs.build.classId)}`);
  cmp("Hit Points marked", `${mine.state.hpMarked} of ${a.hpMax.total}`, `${theirs.state.hpMarked} of ${b.hpMax.total}`);
  cmp("Stress marked", `${mine.state.stressMarked} of ${a.stressMax.total}`, `${theirs.state.stressMarked} of ${b.stressMax.total}`);
  cmp("Hope", mine.state.hope, theirs.state.hope);
  cmp("Armor Slots marked", mine.state.armorMarked, theirs.state.armorMarked);
  cmp("Loadout", list(mine.state.loadout), list(theirs.state.loadout));
  cmp("Vault", list(mine.state.vault), list(theirs.state.vault));
  cmp("Weapons", list([mine.state.activePrimaryId, mine.state.activeSecondaryId].filter(Boolean) as string[]), list([theirs.state.activePrimaryId, theirs.state.activeSecondaryId].filter(Boolean) as string[]));
  cmp("Armor", name(mine.state.armorId), name(theirs.state.armorId));
  cmp("Inventory", items(mine), items(theirs));
  cmp("Gold", gold(mine), gold(theirs));
  cmp("Conditions", list(mine.state.conditions), list(theirs.state.conditions));
  cmp("Session notes", mine.notes.session.length ? `${mine.notes.session.length} characters` : "empty", theirs.notes.session.length ? `${theirs.notes.session.length} characters` : "empty");
  if (mine.notes.session !== theirs.notes.session && mine.notes.session.length === theirs.notes.session.length) out.push({ label: "Session notes", mine: "edited", theirs: "edited differently" });
  if (JSON.stringify(mine.build) !== JSON.stringify(theirs.build) && !out.some((d) => ["Name", "Class"].includes(d.label))) out.push({ label: "Build choices", mine: "differs", theirs: "differs" });
  return out;
}
