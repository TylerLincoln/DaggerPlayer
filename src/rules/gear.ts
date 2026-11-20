// Equipment features that act on their own: triggered effects ("each time you mark an Armor Slot, mark a Stress")
// and conditional bonuses the static modifier parser can't express. Keyed by item type + feature name, because
// names repeat with different text (armor Painful vs. weapon Painful, armor Burning vs. weapon Burning).
// Optional effects ("you can…") stay as text on the sheet: the player decides those.
import type { EntryOf } from "../../content/schema/index.ts";
import type { CharacterDoc } from "./character.ts";
import type { Lookup } from "./derive.ts";

type Weapon = EntryOf<"weapon">;
type Armor = EntryOf<"armor">;

export const LOADOUT_SIZE = 5; // SRD p. 8

/** Gear in use: the sheet's active gear once finished, the builder's picks before that. */
export function activeGear(c: CharacterDoc, lookup: Lookup): { armor: Armor | null; weapons: Weapon[] } {
  const ids = c.finishedAt
    ? { primary: c.state.activePrimaryId, secondary: c.state.activeSecondaryId, armor: c.state.armorId }
    : { primary: c.build.gear.primaryId, secondary: c.build.gear.secondaryId, armor: c.build.gear.armorId };
  const a = lookup.get(ids.armor);
  const weapons = [ids.primary, ids.secondary].map((id) => lookup.get(id)).filter((w): w is Weapon => w?.type === "weapon");
  return { armor: a?.type === "armor" ? a : null, weapons };
}

/** The equipped armor's feature name, if any (e.g. "Painful"). */
export function armorFeature(c: CharacterDoc, lookup: Lookup): string | null {
  return activeGear(c, lookup).armor?.feature?.name ?? null;
}

export const hasArmorFeature = (c: CharacterDoc, lookup: Lookup, name: string) => armorFeature(c, lookup) === name;

/** Attuned armor: "The maximum number of domain cards in your loadout is reduced by one". */
export function loadoutMax(c: CharacterDoc, lookup: Lookup): number {
  return LOADOUT_SIZE - (hasArmorFeature(c, lookup, "Attuned") ? 1 : 0);
}

/** A weapon's feature name, if it has one. */
export const weaponFeature = (w: Weapon | null | undefined) => w?.feature?.name ?? null;

/** How a weapon's damage roll changes (Powerful, Massive, Brutal, Serrated, Sharpwing, Bonded; Sharp armor in Melee). */
export interface DamageRules {
  /** roll this many extra dice and drop the lowest (Powerful, Massive) */
  extraDropLowest: number;
  /** a die showing its maximum adds another die (Brutal) */
  explodeOnMax: boolean;
  /** a die showing 1 deals 8 instead (Serrated) */
  onesAreEight: boolean;
  /** flat bonus from gear, with sources for the roll's explanation */
  bonus: { source: string; value: number }[];
  /** extra dice added to the roll (Sharp armor: +d4 in Melee) */
  extraDice: { source: string; die: number }[];
}

export function damageRules(w: Weapon | null | undefined, c: CharacterDoc, lookup: Lookup, ctx: { level: number; agility: number }): DamageRules {
  const r: DamageRules = { extraDropLowest: 0, explodeOnMax: false, onesAreEight: false, bonus: [], extraDice: [] };
  const f = weaponFeature(w);
  if (f === "Powerful" || f === "Massive") r.extraDropLowest = 1;
  if (f === "Brutal") r.explodeOnMax = true;
  if (f === "Serrated") r.onesAreEight = true;
  if (f === "Sharpwing") r.bonus.push({ source: "Sharpwing (Agility)", value: ctx.agility });
  if (f === "Bonded") r.bonus.push({ source: "Bonded (level)", value: ctx.level });
  if (w && w.range === "melee" && hasArmorFeature(c, lookup, "Sharp")) r.extraDice.push({ source: "Sharp armor", die: 4 });
  return r;
}

/** What happens on your own sheet after a successful attack with this weapon (rolled automatically where the text says to roll). */
export function onHit(w: Weapon | null | undefined, c: CharacterDoc, lookup: Lookup, crit: boolean, roll: (sides: number) => number): { stress: number; clearStress: number; clearHp: number; notes: string[]; ask: "hp-or-stress" | null } {
  const out = { stress: 0, clearStress: 0, clearHp: 0, notes: [] as string[], ask: null as "hp-or-stress" | null };
  const f = weaponFeature(w);
  if (f === "Painful") {
    out.stress += 1;
    out.notes.push("Painful: marked a Stress for the successful attack.");
  }
  if (f === "Invigorating") {
    const n = roll(4);
    if (n === 4) { out.clearStress += 1; out.notes.push("Invigorating: rolled 4, cleared a Stress."); }
    else out.notes.push(`Invigorating: rolled ${n}, no effect.`);
  }
  if (f === "Lifestealing") {
    const n = roll(6);
    // "clear a Hit Point or clear a Stress": the player chooses (owner ruling 2026-11-20)
    if (n === 6) { out.ask = "hp-or-stress"; out.notes.push("Lifestealing: rolled 6, clear a Hit Point or a Stress."); }
    else out.notes.push(`Lifestealing: rolled ${n}, no effect.`);
  }
  if (crit && w?.range === "melee" && hasArmorFeature(c, lookup, "Bloodthirsty")) {
    out.clearHp += 1;
    out.notes.push("Bloodthirsty armor: critical Melee hit, cleared a Hit Point.");
  }
  return out;
}

/** Reloading: "After you make an attack, roll a d6. On a result of 1, you must mark a Stress to reload this weapon." */
export function afterAttack(w: Weapon | null | undefined, roll: (sides: number) => number): string[] {
  if (weaponFeature(w) !== "Reloading") return [];
  const n = roll(6);
  return [n === 1 ? `Reloading: rolled 1, mark a Stress to reload ${w!.name} before you fire it again.` : `Reloading: rolled ${n}, no reload needed.`];
}
