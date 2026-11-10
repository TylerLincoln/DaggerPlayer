// Table-play rules for the sheet. Pure: each function takes the character (and derived numbers)
// and returns a new character plus notes for the UI. Page refs are SRD 2.0.
import type { CharacterDoc } from "./character.ts";
import { derive, type Derived, type Lookup } from "./derive.ts";
import { type Rng, roll } from "./dice.ts";
import { LOADOUT_MAX } from "./levelup.ts";

export class RuleError extends Error {}

export interface Result {
  doc: CharacterDoc;
  notes: string[];
}

const clone = (c: CharacterDoc) => structuredClone(c);
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---------- trackers (p. 50) ----------

/** Vulnerable while every Stress slot is marked (p. 50: until at least 1 Stress is cleared). */
export const stressVulnerable = (c: CharacterDoc, d: Derived) => c.state.stressMarked >= d.stressMax.total;

/**
 * Mark Stress. If none can be marked, mark 1 HP instead (p. 50). Marking more than is free fills the
 * track; the shortfall is treated the same way (1 HP, once).
 */
export function markStress(c: CharacterDoc, d: Derived, n = 1): Result {
  let doc = clone(c);
  const notes: string[] = [];
  const free = d.stressMax.total - doc.state.stressMarked;
  if (free <= 0 || n > free) {
    doc.state.stressMarked = d.stressMax.total;
    const hp = markHp(doc, d, 1);
    doc = hp.doc;
    notes.push(...hp.notes.filter((x) => !/death move/.test(x)));
    notes.push(free <= 0 ? "All Stress is marked, so you mark 1 Hit Point instead." : `Only ${free} Stress could be marked; you mark 1 Hit Point instead of the rest.`);
  } else doc.state.stressMarked += n;
  if (doc.state.stressMarked >= d.stressMax.total && c.state.stressMarked < d.stressMax.total) notes.push("You marked your last Stress: you're Vulnerable until you clear at least 1 Stress.");
  if (doc.state.hpMarked >= d.hpMax.total && c.state.hpMarked < d.hpMax.total) notes.push("You marked your last Hit Point: make a death move.");
  return { doc, notes };
}

export function clearStress(c: CharacterDoc, n = 1): CharacterDoc {
  const doc = clone(c);
  doc.state.stressMarked = Math.max(0, doc.state.stressMarked - n);
  return doc;
}

export function markHp(c: CharacterDoc, d: Derived, n = 1): Result {
  const doc = clone(c);
  doc.state.hpMarked = clamp(doc.state.hpMarked + n, 0, d.hpMax.total);
  const notes = doc.state.hpMarked >= d.hpMax.total && c.state.hpMarked < d.hpMax.total ? ["You marked your last Hit Point: make a death move."] : [];
  if (notes.length && doc.state.beastformId) {
    doc.state.beastformId = null;
    doc.state.beastformEvolutionTrait = null;
    notes.push("You drop out of your Beastform.");
  }
  return { doc, notes };
}

export function clearHp(c: CharacterDoc, n = 1): CharacterDoc {
  const doc = clone(c);
  doc.state.hpMarked = Math.max(0, doc.state.hpMarked - n);
  return doc;
}

/** Hope can't exceed the maximum (6 minus scars, p. 49). Gains past the cap are lost. */
export function gainHope(c: CharacterDoc, d: Derived, n = 1): CharacterDoc {
  const doc = clone(c);
  doc.state.hope = clamp(doc.state.hope + n, 0, d.hopeMax);
  return doc;
}

export function spendHope(c: CharacterDoc, n = 1): CharacterDoc {
  if (c.state.hope < n) throw new RuleError(`You need ${n} Hope and have ${c.state.hope}.`);
  const doc = clone(c);
  doc.state.hope -= n;
  return doc;
}

/** Armor Slots: with an Armor Score of 0 you can't mark any (p. 72). */
export function markArmor(c: CharacterDoc, d: Derived, n = 1): CharacterDoc {
  if (d.armorScore.total === 0) throw new RuleError("With an Armor Score of 0 you can't mark Armor Slots.");
  if (c.state.armorMarked + n > d.armorScore.total) throw new RuleError("No unmarked Armor Slots left.");
  const doc = clone(c);
  doc.state.armorMarked += n;
  return doc;
}

export function clearArmor(c: CharacterDoc, n = 1): CharacterDoc {
  const doc = clone(c);
  doc.state.armorMarked = Math.max(0, doc.state.armorMarked - n);
  return doc;
}

// ---------- domain cards (p. 8) ----------

/** Move a card from the loadout to the vault: always free. */
export function toVault(c: CharacterDoc, cardId: string): CharacterDoc {
  if (!c.state.loadout.includes(cardId)) throw new RuleError("That card isn't in your loadout.");
  const doc = clone(c);
  doc.state.loadout = doc.state.loadout.filter((x) => x !== cardId);
  doc.state.vault.push(cardId);
  return doc;
}

/**
 * Move a card from the vault to the loadout. Free during a rest (before downtime moves);
 * otherwise mark Stress equal to its Recall Cost. If the loadout is full, `swapOutId` goes to the vault (free).
 */
export function fromVault(c: CharacterDoc, lookup: Lookup, cardId: string, opts: { resting: boolean; swapOutId?: string }): Result {
  if (!c.state.vault.includes(cardId)) throw new RuleError("That card isn't in your vault.");
  const picked = lookup.get(cardId);
  if (picked?.type === "domain-card" && picked.vaultOnAcquire) throw new RuleError(`${picked.name} stays in your vault permanently.`);
  let doc = clone(c);
  if (doc.state.loadout.length >= LOADOUT_MAX) {
    if (!opts.swapOutId) throw new RuleError(`Your loadout holds ${LOADOUT_MAX} cards: choose one to move to the vault.`);
    doc = toVault(doc, opts.swapOutId);
  }
  doc.state.vault = doc.state.vault.filter((x) => x !== cardId);
  doc.state.loadout.push(cardId);
  const card = lookup.get(cardId);
  const cost = !opts.resting && card?.type === "domain-card" ? card.recallCost : 0;
  if (cost === 0) return { doc, notes: [] };
  const d = derive(c, lookup);
  if (c.state.stressMarked >= d.stressMax.total) throw new RuleError("All your Stress is marked, so you can't pay the Recall Cost (p. 50).");
  const r = markStress(doc, derive(doc, lookup), cost);
  return { doc: r.doc, notes: [`Marked ${cost} Stress (Recall Cost).`, ...r.notes] };
}

// ---------- weapons and armor (p. 55) ----------

export const INVENTORY_WEAPONS_MAX = 2;

/** Swap an inventory weapon into an active slot: free during a rest or moment of calm, otherwise 1 Stress. */
export function swapWeapon(c: CharacterDoc, lookup: Lookup, inventoryWeaponId: string, calm: boolean): Result {
  const w = lookup.get(inventoryWeaponId);
  if (w?.type !== "weapon") throw new RuleError("That's not a weapon.");
  if (!c.state.inventoryWeaponIds.includes(inventoryWeaponId)) throw new RuleError("That weapon isn't in your inventory.");
  const d = derive(c, lookup);
  if (w.tier > d.tier) throw new RuleError(`You can't equip a Tier ${w.tier} weapon at tier ${d.tier}.`);
  const doc = clone(c);
  const s = doc.state;
  s.inventoryWeaponIds = s.inventoryWeaponIds.filter((x) => x !== inventoryWeaponId);
  const slot = w.category === "primary" ? "activePrimaryId" : "activeSecondaryId";
  const displaced = [s[slot]];
  s[slot] = w.id;
  // a two-handed primary leaves no hand for a secondary (burden 2, p. 55)
  if (w.category === "primary" && w.burden === 2 && s.activeSecondaryId) {
    displaced.push(s.activeSecondaryId);
    s.activeSecondaryId = null;
  }
  if (w.category === "secondary") {
    const p = lookup.get(s.activePrimaryId);
    if (p?.type === "weapon" && p.burden === 2) {
      displaced.push(s.activePrimaryId);
      s.activePrimaryId = null;
    }
  }
  for (const id of displaced) if (id) s.inventoryWeaponIds.push(id);
  if (s.inventoryWeaponIds.length > INVENTORY_WEAPONS_MAX) throw new RuleError(`You can carry only ${INVENTORY_WEAPONS_MAX} inventory weapons.`);
  if (calm) return { doc, notes: [] };
  const r = markStress(doc, derive(doc, lookup), 1);
  return { doc: r.doc, notes: ["Marked 1 Stress to swap weapons in danger.", ...r.notes] };
}

// ---------- gold (p. 84) ----------

export type Gold = CharacterDoc["state"]["gold"];

/** Add gold of one denomination; 10 handfuls make a bag and 10 bags a chest. You can't hold more than 1 chest. */
export function addGold(g: Gold, kind: keyof Gold, n = 1): Gold {
  const handfuls = g.handfuls + g.bags * 10 + g.chests * 100 + n * (kind === "handfuls" ? 1 : kind === "bags" ? 10 : 100);
  if (handfuls > 199) throw new RuleError("You can't hold more than 1 chest: spend or store some gold first.");
  if (handfuls < 0) throw new RuleError("You don't have that much gold.");
  return { chests: Math.floor(handfuls / 100), bags: Math.floor((handfuls % 100) / 10), handfuls: handfuls % 10 };
}

// ---------- consumables (p. 80) ----------

export const CONSUMABLE_MAX = 5;

export function setItemQty(c: CharacterDoc, lookup: Lookup, itemId: string, qty: number): CharacterDoc {
  const doc = clone(c);
  const item = doc.state.inventory.find((i) => i.id === itemId);
  if (!item) throw new RuleError("Item not found.");
  const consumable = lookup.get(item.entryId)?.type === "consumable";
  if (consumable && qty > CONSUMABLE_MAX) throw new RuleError(`You can hold up to ${CONSUMABLE_MAX} of each consumable.`);
  item.qty = Math.max(0, qty);
  return doc;
}

// ---------- rests (p. 52) ----------

export type RestKind = "short" | "long";
export type DowntimeMove = "tend" | "stress" | "armor" | "prepare" | "prepare-together" | "project";

export const DOWNTIME_MOVES: Record<RestKind, { id: DowntimeMove; label: string }[]> = {
  short: [
    { id: "tend", label: "Tend to Wounds (clear 1d4+Tier HP)" },
    { id: "stress", label: "Clear Stress (clear 1d4+Tier Stress)" },
    { id: "armor", label: "Repair Armor (clear 1d4+Tier Armor Slots)" },
    { id: "prepare", label: "Prepare (gain a Hope)" },
    { id: "prepare-together", label: "Prepare with party members (gain 2 Hope)" },
  ],
  long: [
    { id: "tend", label: "Tend to All Wounds (clear all HP)" },
    { id: "stress", label: "Clear All Stress" },
    { id: "armor", label: "Repair All Armor" },
    { id: "prepare", label: "Prepare (gain a Hope)" },
    { id: "prepare-together", label: "Prepare with party members (gain 2 Hope)" },
    { id: "project", label: "Work on a Project" },
  ],
};

/** After three short rests in a row the next rest must be long (p. 52). */
export const mustLongRest = (c: CharacterDoc) => (c.state.rests?.shortInARow ?? 0) >= 3;

/**
 * Take a rest with up to two downtime moves on yourself (the same move may be chosen twice).
 * Moves that help an ally only affect the ally, so they don't change this sheet.
 * Rest-limited effects expire at the end (temporary effects marked "until rest" are removed).
 */
export function takeRest(c: CharacterDoc, lookup: Lookup, kind: RestKind, moves: DowntimeMove[], rng?: Rng): Result {
  if (moves.length > 2) throw new RuleError("Choose up to two downtime moves.");
  if (kind === "short" && mustLongRest(c)) throw new RuleError("After three short rests in a row, your next rest must be a long rest.");
  let doc = clone(c);
  const notes: string[] = [];
  for (const m of moves) {
    const d = derive(doc, lookup);
    const amount = () => {
      const r = roll(`1d4+${d.tier}`, rng);
      notes.push(`Rolled ${r.dice[0].value}+${d.tier} = ${r.total}.`);
      return r.total;
    };
    switch (m) {
      case "tend": {
        const n = kind === "long" ? doc.state.hpMarked : amount();
        doc = clearHp(doc, n);
        notes.push(kind === "long" ? "Cleared all Hit Points." : `Cleared up to ${n} Hit Points.`);
        break;
      }
      case "stress": {
        const n = kind === "long" ? doc.state.stressMarked : amount();
        doc = clearStress(doc, n);
        notes.push(kind === "long" ? "Cleared all Stress." : `Cleared up to ${n} Stress.`);
        break;
      }
      case "armor": {
        const n = kind === "long" ? doc.state.armorMarked : amount();
        doc = clearArmor(doc, n);
        notes.push(kind === "long" ? "Repaired all armor." : `Cleared up to ${n} Armor Slots.`);
        break;
      }
      case "prepare":
      case "prepare-together": {
        const n = m === "prepare" ? 1 : 2;
        doc = gainHope(doc, d, n);
        notes.push(`Gained ${n} Hope.`);
        break;
      }
      case "project":
        if (kind !== "long") throw new RuleError("Work on a Project is a long-rest move.");
        notes.push("Advance your project's countdown (or roll, at the GM's choice).");
        break;
    }
  }
  // companion clears Stress with you (p. 21); a long rest brings a companion who dropped out back with 1 Stress cleared
  if (doc.state.companion) {
    const cleared = c.state.stressMarked - doc.state.stressMarked;
    const comp = doc.state.companion;
    comp.stressMarked = Math.max(0, comp.stressMarked - Math.max(0, cleared) - (kind === "long" && cleared === 0 ? 1 : 0));
  }
  doc = resetUses(doc, kind === "short" ? ["rest"] : ["rest", "long-rest"]);
  doc.state.rests = { shortInARow: kind === "short" ? (c.state.rests?.shortInARow ?? 0) + 1 : 0 };
  const expiring = doc.state.effects.filter((e) => e.until === "rest" || (kind === "long" && e.until === "long-rest"));
  doc.state.effects = doc.state.effects.filter((e) => !expiring.includes(e));
  if (expiring.length) notes.push(`Expired: ${expiring.map((e) => e.label).join(", ")}.`);
  notes.push(kind === "short" ? "Per-rest features refresh." : "Per-rest and per-long-rest features refresh.");
  return { doc, notes };
}


// ---------- limited-use features and resources ----------

export type Frequency = "scene" | "rest" | "long-rest" | "session";

/** "Once per rest/long rest/session/scene" in a feature's text (the first such phrase). */
export function frequencyOf(text: string): Frequency | null {
  const m = text.replace(/\{\{[^|}]+\|([^}]+)\}\}/g, "$1").match(/once per (long rest|rest|session|scene)/i);
  if (!m) return null;
  return m[1].toLowerCase() === "long rest" ? "long-rest" : (m[1].toLowerCase() as Frequency);
}

export const useKey = (freq: Frequency, name: string) => `use:${freq}:${name}`;

export function toggleUsed(c: CharacterDoc, key: string): CharacterDoc {
  const doc = clone(c);
  if (doc.state.resources[key]) delete doc.state.resources[key];
  else doc.state.resources[key] = 1;
  return doc;
}

/** Clear per-use marks for the given frequencies, and resources that reset with them. */
export function resetUses(c: CharacterDoc, freqs: Frequency[]): CharacterDoc {
  const doc = clone(c);
  for (const k of Object.keys(doc.state.resources)) if (freqs.some((f) => k.startsWith(`use:${f}:`))) delete doc.state.resources[k];
  return doc;
}

/** Current value of a resource (its starting value until first changed). */
export function resourceValue(c: CharacterDoc, r: { id: string; start?: number; kind: string }): number | number[] {
  const v = c.state.resources[r.id];
  if (v !== undefined) return v;
  return r.kind === "dice-pool" ? [] : (r.start ?? 0);
}

export function setResource(c: CharacterDoc, id: string, value: number | number[], max?: number): CharacterDoc {
  const doc = clone(c);
  doc.state.resources[id] = typeof value === "number" ? clamp(value, 0, max ?? 99) : value;
  return doc;
}

/** Roll a dice pool such as Prayer Dice: `count` dice of the given size. */
export function rollPool(c: CharacterDoc, id: string, count: number, die: string, rng?: Rng): CharacterDoc {
  const sides = Number(die.slice(1));
  const values = Array.from({ length: Math.max(0, count) }, () => roll(`1d${sides}`, rng).total);
  return setResource(c, id, values);
}

export function spendPoolDie(c: CharacterDoc, id: string, index: number): CharacterDoc {
  const cur = c.state.resources[id];
  if (!Array.isArray(cur) || index < 0 || index >= cur.length) throw new RuleError("That die isn't in the pool.");
  return setResource(c, id, cur.filter((_, i) => i !== index));
}

/**
 * Start a new session: clears "once per session" marks and session resources
 * (unspent Prayer Dice clear at the end of a session, p. 24).
 */
export function newSession(c: CharacterDoc, d: Derived): CharacterDoc {
  let doc = resetUses(c, ["session"]);
  for (const r of d.resources) if (r.resetOn === "session") doc = setResource(doc, r.id, r.kind === "dice-pool" ? [] : (r.start ?? 0));
  return doc;
}

// ---------- Beastform (Druid, pp. 14–18) ----------

/**
 * Transform into a Beastform of your tier or lower. Normally mark a Stress; with Evolution, spend 3 Hope
 * instead and raise one trait by +1 until you drop out.
 */
export function transform(c: CharacterDoc, lookup: Lookup, formId: string, opts: { evolution?: import("../../content/schema/index.ts").Trait } = {}): Result {
  const d = derive(c, lookup);
  if (!d.features.some((f) => f.feature.name === "Beastform")) throw new RuleError("You don't have the Beastform feature.");
  const form = lookup.get(formId);
  if (form?.type !== "beastform") throw new RuleError("That's not a Beastform.");
  if (form.tier > d.tier) throw new RuleError(`${form.name} is a Tier ${form.tier} form; you can take forms of tier ${d.tier} or lower.`);
  let doc = clone(c);
  const notes: string[] = [];
  if (opts.evolution) {
    if (!d.features.some((f) => f.feature.name === "Evolution")) throw new RuleError("You don't have Evolution.");
    if (c.state.hope < 3) throw new RuleError("Evolution costs 3 Hope.");
    doc.state.hope -= 3;
    notes.push(`Spent 3 Hope (Evolution): +1 ${opts.evolution} while in this form.`);
  } else {
    if (c.state.stressMarked >= d.stressMax.total) throw new RuleError("All your Stress is marked, so you can't mark a Stress to transform (p. 50).");
    const r = markStress(doc, d, 1);
    doc = r.doc;
    notes.push("Marked a Stress to transform.", ...r.notes);
  }
  doc.state.beastformId = form.id;
  doc.state.beastformEvolutionTrait = opts.evolution ?? null;
  notes.push(`You're a ${form.name}. You can't use weapons or cast spells from domain cards while transformed.`);
  return { doc, notes };
}

export function dropBeastform(c: CharacterDoc): CharacterDoc {
  const doc = clone(c);
  doc.state.beastformId = null;
  doc.state.beastformEvolutionTrait = null;
  return doc;
}

// ---------- companion (Beastbound) ----------

export function markCompanionStress(c: CharacterDoc, d: Derived, n: number): Result {
  if (!c.state.companion || !d.companion) throw new RuleError("No companion.");
  const doc = clone(c);
  const max = d.companion.stressMax?.total ?? 0;
  const comp = doc.state.companion!;
  comp.stressMarked = clamp(comp.stressMarked + n, 0, max);
  const notes = n > 0 && comp.stressMarked >= max && c.state.companion.stressMarked < max ? [`${d.companion.name || "Your companion"} marks their last Stress and drops out of the scene until your next long rest.`] : [];
  return { doc, notes };
}
