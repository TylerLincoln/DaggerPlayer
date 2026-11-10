// Leveling up (SRD pp. 53–54). Slot counts per tier are owner-supplied (progression.advancements[].slotsByTier).
// Where the class sheet and the SRD disagree, the SRD wins (owner ruling 2026-11-06).
import { TRAITS, type EntryOf, type Trait } from "../../content/schema/index.ts";
import type { CharacterDoc, LevelUp } from "./character.ts";
import { ACHIEVEMENT_LEVELS, derive, HP_MAX, type Lookup, ownedCards, STRESS_MAX, tierOf } from "./derive.ts";

export { ownedCards };

export type Advancement = LevelUp["advancements"][number];
type Progression = EntryOf<"progression">;

export const MAX_LEVEL = 10;
export const LOADOUT_MAX = 5; // SRD p. 8

export function progressionOf(lookup: Lookup): Progression {
  const p = lookup.get("srd/progression/leveling");
  if (p?.type !== "progression") throw new Error("leveling rules (srd/progression/leveling) aren't loaded");
  return p;
}

const costOf = (p: Progression, optionId: string) => p.advancements.find((a) => a.id === optionId)?.cost ?? 1;

/**
 * Replays advancement history and returns marked slots per tier table ("3:hp" → 2),
 * plus crossed-out options per tier. Each pick marks a slot in the highest table ≤ its level's tier
 * that still has room (players may use "any from the previous tier", sheet/SRD p. 54).
 */
export function slotLedger(p: Progression, levelUps: LevelUp[]) {
  const marked = new Map<string, number>();
  const crossed = new Set<string>(); // "3:multiclass", "*:multiclass"
  for (const lu of levelUps) {
    const tier = tierOf(lu.level);
    for (const a of lu.advancements) {
      const opt = p.advancements.find((o) => o.id === a.optionId);
      if (!opt) continue;
      for (let t = tier; t >= 2; t--) {
        const total = opt.slotsByTier[String(t) as "2" | "3" | "4"] ?? 0;
        const used = marked.get(`${t}:${opt.id}`) ?? 0;
        if (used + opt.cost <= total) {
          marked.set(`${t}:${opt.id}`, used + opt.cost);
          break;
        }
      }
      if (a.optionId === "subclass") crossed.add(`${tier}:multiclass`);
      if (a.optionId === "multiclass") {
        crossed.add(`${tier}:subclass`);
        crossed.add("*:multiclass");
      }
    }
  }
  return { marked, crossed };
}

/** Traits marked by advancements since the last clear (tier achievements at levels 5 and 8 clear them). */
export function markedTraits(levelUps: LevelUp[], atLevel: number): Set<Trait> {
  const lastClear = Math.max(0, ...ACHIEVEMENT_LEVELS.filter((l) => l >= 5 && l <= atLevel));
  const out = new Set<Trait>();
  for (const lu of levelUps) if (lu.level >= lastClear && lu.level < atLevel) for (const a of lu.advancements) if (a.optionId === "traits") a.traits?.forEach((t) => out.add(t));
  return out;
}

function multiclassOf(c: CharacterDoc): Advancement | undefined {
  return c.levelUps.flatMap((lu) => lu.advancements).find((a) => a.optionId === "multiclass");
}

/** Highest card level allowed from a domain at a character level (SRD p. 54: multiclass domain ≤ half level, rounded up). */
export function cardLevelLimit(c: CharacterDoc, lookup: Lookup, level: number, domainId: string, pendingMulticlass?: Advancement): number {
  const cls = lookup.get(c.build.classId);
  if (cls?.type === "class" && cls.domainIds.includes(domainId)) return level;
  const mc = pendingMulticlass ?? multiclassOf(c);
  if (mc?.domainId === domainId) return Math.ceil(level / 2);
  return 0;
}

export interface OptionStatus {
  id: string;
  text: string;
  cost: 1 | 2;
  /** unmarked slots in tables at or below the level's tier */
  slotsLeft: number;
  available: boolean;
  reason?: string;
}

/** Which advancements can be picked at `level`, given history and picks already made this level. */
export function optionStatus(c: CharacterDoc, lookup: Lookup, level: number, picks: Advancement[] = []): OptionStatus[] {
  const p = progressionOf(lookup);
  const tier = tierOf(level);
  const { marked, crossed } = slotLedger(p, [...c.levelUps, { level, advancements: picks, domainCardId: null, exchange: null }]);
  const used = picks.reduce((n, a) => n + costOf(p, a.optionId), 0);
  const d = derive({ ...c, levelUps: [...c.levelUps, { level, advancements: picks, domainCardId: null, exchange: null }] }, lookup);
  const subUpgrades = c.levelUps.flatMap((lu) => lu.advancements).concat(picks).filter((a) => a.optionId === "subclass").length;
  const unmarkedTraits = TRAITS.filter((t) => !markedTraits(c.levelUps, level).has(t) && !picks.some((a) => a.traits?.includes(t)));

  return p.advancements.map((opt) => {
    let slotsLeft = 0;
    for (let t = 2; t <= tier; t++) slotsLeft += (opt.slotsByTier[String(t) as "2" | "3" | "4"] ?? 0) - (marked.get(`${t}:${opt.id}`) ?? 0);
    const status: OptionStatus = { id: opt.id, text: opt.text, cost: opt.cost, slotsLeft, available: true };
    const no = (reason: string) => ({ ...status, available: false, reason });
    if (slotsLeft < opt.cost) return no(slotsLeft > 0 ? "Needs two unmarked slots in one tier." : "No unmarked slots left in your tier or below.");
    if (used + opt.cost > 2) return no(opt.cost === 2 ? "Uses both of this level's advancements." : "You've already chosen two advancements.");
    if (opt.minLevel && level < opt.minLevel) return no(`Available from level ${opt.minLevel}.`);
    if (crossed.has(`${tier}:${opt.id}`) || crossed.has(`*:${opt.id}`)) return no(opt.id === "multiclass" ? "Crossed out (multiclass or upgraded subclass taken)." : "Crossed out by multiclassing this tier.");
    if (opt.id === "hp" && d.hpMax.total >= HP_MAX) return no(`Hit Points are at the maximum of ${HP_MAX}.`);
    if (opt.id === "stress" && d.stressMax.total >= STRESS_MAX) return no(`Stress is at the maximum of ${STRESS_MAX}.`);
    if (opt.id === "traits" && unmarkedTraits.length < 2) return no("Fewer than two unmarked traits.");
    if (opt.id === "subclass" && subUpgrades >= 2) return no("You already have your subclass's mastery.");
    return status;
  });
}

export function emptyLevelUp(c: CharacterDoc): LevelUp {
  const level = 1 + c.levelUps.length + 1;
  return {
    level,
    advancements: [],
    ...(ACHIEVEMENT_LEVELS.includes(level) ? { newExperience: { id: crypto.randomUUID(), name: "", bonus: 2 } } : {}),
    domainCardId: null,
    exchange: null,
  };
}

/** Problems with a proposed level-up; empty when it can be applied. */
export function validateLevelUp(c: CharacterDoc, lu: LevelUp, lookup: Lookup): string[] {
  const errs: string[] = [];
  const p = progressionOf(lookup);
  const current = 1 + c.levelUps.length;
  if (!c.finishedAt) errs.push("Finish the character before leveling up.");
  if (current >= MAX_LEVEL) errs.push(`Level ${MAX_LEVEL} is the highest level.`);
  if (lu.level !== current + 1) errs.push(`This level-up should be for level ${current + 1}.`);
  const level = lu.level;

  // step one
  if (ACHIEVEMENT_LEVELS.includes(level) && !lu.newExperience?.name.trim()) errs.push(`Level ${level} gives a new Experience at +2: name it.`);

  // step two
  const used = lu.advancements.reduce((n, a) => n + costOf(p, a.optionId), 0);
  if (used !== 2) errs.push(`Choose two advancements (${used} of 2).`);
  for (let i = 0; i < lu.advancements.length; i++) {
    const a = lu.advancements[i];
    const st = optionStatus(c, lookup, level, lu.advancements.slice(0, i)).find((o) => o.id === a.optionId);
    if (!st) errs.push(`Unknown advancement "${a.optionId}".`);
    else if (!st.available) errs.push(`${st.id}: ${st.reason}`);
    const owned = ownedCards(c);
    const xpIds = new Set([...c.build.experiences, ...c.levelUps.flatMap((x) => (x.newExperience ? [x.newExperience] : [])), ...(lu.newExperience ? [lu.newExperience] : [])].map((x) => x.id));
    switch (a.optionId) {
      case "traits": {
        const marked = markedTraits(c.levelUps, level);
        const others = lu.advancements.slice(0, i).flatMap((x) => (x.optionId === "traits" ? x.traits ?? [] : []));
        if (a.traits?.length !== 2 || new Set(a.traits).size !== 2) errs.push("Pick two different traits to increase.");
        else for (const t of a.traits) if (marked.has(t) || others.includes(t)) errs.push(`${t} is already marked this tier.`);
        break;
      }
      case "experiences":
        if (a.experienceIds?.length !== 2 || new Set(a.experienceIds).size !== 2) errs.push("Pick two different Experiences to improve.");
        else if (a.experienceIds.some((id) => !xpIds.has(id))) errs.push("Pick Experiences your character has.");
        break;
      case "domain-card":
        errs.push(...checkCard(c, lookup, level, a.cardId, [...owned, lu.domainCardId ?? ""], "Advancement card"));
        break;
      case "subclass":
        if (a.subclassId !== c.build.subclassId) errs.push("The upgraded card must be for your subclass.");
        break;
      case "multiclass": {
        const mc = lookup.get(a.classId);
        const sub = lookup.get(a.subclassId);
        if (mc?.type !== "class") errs.push("Choose a class to multiclass into.");
        else {
          if (mc.id === c.build.classId) errs.push("Multiclass into a different class.");
          if (!a.domainId || !mc.domainIds.includes(a.domainId)) errs.push(`Choose one of ${mc.name}'s domains.`);
          if (sub?.type !== "subclass" || sub.classId !== mc.id) errs.push(`Choose a ${mc.name} subclass for its foundation card.`);
        }
        break;
      }
    }
  }

  // choices on cards taken this level (Vitality: two benefits; Master of the Craft: +2/+2 or +3)
  const newCardIds = [lu.domainCardId, lu.exchange?.toId, ...lu.advancements.map((a) => a.cardId)].filter((x): x is string => !!x);
  for (const id of newCardIds) {
    const card = lookup.get(id);
    if (card?.type !== "domain-card") continue;
    for (const ch of card.choices ?? []) errs.push(...checkChoice(ch, lu.choices?.[ch.id], c, lu, card.name));
  }

  // companion (Beastbound, p. 22): one option per level-up, each option once; a new Experience at 2, 5, 8
  if (c.state.companion && derive(c, lookup).companion) {
    const taken = c.levelUps.map((x) => x.companionOption?.split(":")[0]).filter(Boolean);
    const opt = lu.companionOption;
    const base = opt?.split(":")[0];
    if (!opt) errs.push("Choose a level-up option for your companion.");
    else if (!COMPANION_OPTIONS.includes(base!)) errs.push("Unknown companion option.");
    else if (taken.includes(base)) errs.push("Your companion already has that option.");
    else if (base === "vicious" && !/^vicious:(die|range)$/.test(opt)) errs.push("Vicious: choose damage die or range.");
    else if (base === "intelligent" && !opt.slice(12)) errs.push("Intelligent: choose a Companion Experience.");
    if (ACHIEVEMENT_LEVELS.includes(level) && !lu.companionExperience?.name.trim()) errs.push("Your companion also gains a new Experience at +2: name it.");
  }

  // step four
  const mc = lu.advancements.find((a) => a.optionId === "multiclass");
  const advCards = lu.advancements.filter((a) => a.optionId === "domain-card").map((a) => a.cardId ?? "");
  errs.push(...checkCard(c, lookup, level, lu.domainCardId ?? undefined, [...ownedCards(c), ...advCards], "New domain card", mc));
  if (lu.exchange) {
    const from = lookup.get(lu.exchange.fromId);
    const to = lookup.get(lu.exchange.toId);
    if (!ownedCards(c).includes(lu.exchange.fromId)) errs.push("You can only exchange a card you already have.");
    else if (from?.type === "domain-card" && to?.type === "domain-card") {
      if (to.level > from.level) errs.push(`Exchange for a card of level ${from.level} or lower.`);
      errs.push(...checkCard(c, lookup, level, to.id, [...ownedCards(c), lu.domainCardId ?? "", ...advCards], "Exchanged card", mc));
    } else errs.push("Choose the card to exchange it for.");
  }
  return errs;
}

export const COMPANION_OPTIONS = ["intelligent", "light-in-the-dark", "creature-comfort", "armored", "vicious", "resilient", "bonded", "aware"];

function checkChoice(ch: NonNullable<EntryOf<"domain-card">["choices"]>[number], value: string | undefined, c: CharacterDoc, lu: LevelUp, label: string): string[] {
  if (!value) return [`${label}: ${ch.prompt}`];
  if (Array.isArray(ch.options)) {
    const picked = value.split(",").filter(Boolean);
    const ids = ch.options.map((o) => (typeof o === "string" ? o : o.id));
    if (picked.length !== ch.count || new Set(picked).size !== picked.length || picked.some((p) => !ids.includes(p))) return [`${label}: choose ${ch.count}.`];
    return [];
  }
  if (typeof ch.options === "object" && ch.options.type === "experience-bonus") {
    const xpIds = [...c.build.experiences, ...c.levelUps.flatMap((x) => (x.newExperience ? [x.newExperience] : [])), ...(lu.newExperience ? [lu.newExperience] : [])].map((x) => x.id);
    const [mode, ids = ""] = value.split(":");
    const picked = ids.split(",").filter(Boolean);
    const need = mode === "one" ? 1 : mode === "two" ? 2 : 0;
    if (!need || picked.length !== need || new Set(picked).size !== need || picked.some((p) => !xpIds.includes(p))) return [`${label}: pick ${need === 1 ? "one Experience for +3" : "two Experiences for +2"}.`];
  }
  return [];
}

function checkCard(c: CharacterDoc, lookup: Lookup, level: number, id: string | undefined, owned: string[], label: string, pendingMc?: Advancement): string[] {
  if (!id) return [`${label}: choose a card.`];
  const card = lookup.get(id);
  if (card?.type !== "domain-card") return [`${label}: card not found.`];
  const limit = cardLevelLimit(c, lookup, level, card.domainId, pendingMc);
  if (limit === 0) return [`${label}: ${card.name} isn't from one of your domains.`];
  if (card.level > limit) return [`${label}: ${card.name} is level ${card.level}; you can take level ${limit} or lower from that domain.`];
  if (owned.filter((x) => x === id).length > 0) return [`${label}: you already have ${card.name}.`];
  return [];
}

/** Apply a validated level-up: record it and put new cards in the loadout (or the vault if it's full). */
export function applyLevelUp(c: CharacterDoc, lu: LevelUp, lookup: Lookup): CharacterDoc {
  const errs = validateLevelUp(c, lu, lookup);
  if (errs.length) throw new Error(`invalid level-up: ${errs.join(" ")}`);
  const next: CharacterDoc = structuredClone(c);
  next.levelUps.push(structuredClone(lu));
  const s = next.state;
  if (lu.exchange) {
    s.loadout = s.loadout.map((x) => (x === lu.exchange!.fromId ? lu.exchange!.toId : x));
    s.vault = s.vault.map((x) => (x === lu.exchange!.fromId ? lu.exchange!.toId : x));
  }
  const newCards = [...lu.advancements.filter((a) => a.optionId === "domain-card").map((a) => a.cardId!), lu.domainCardId!];
  for (const id of newCards) {
    const card = lookup.get(id);
    // "place this card in your vault permanently" (Vitality, Master of the Craft)
    const toVault = (card?.type === "domain-card" && card.vaultOnAcquire) || s.loadout.length >= LOADOUT_MAX;
    (toVault ? s.vault : s.loadout).push(id);
  }
  Object.assign(next.build.featureChoices, lu.choices ?? {});
  return next;
}

/** Undo the most recent level-up (rolls back its cards and exchange). */
export function undoLastLevelUp(c: CharacterDoc): CharacterDoc {
  const lu = c.levelUps[c.levelUps.length - 1];
  if (!lu) return c;
  const next: CharacterDoc = structuredClone(c);
  next.levelUps.pop();
  for (const k of Object.keys(lu.choices ?? {})) delete next.build.featureChoices[k];
  const s = next.state;
  const added = new Set([...lu.advancements.filter((a) => a.optionId === "domain-card").map((a) => a.cardId), lu.domainCardId]);
  s.loadout = s.loadout.filter((x) => !added.has(x));
  s.vault = s.vault.filter((x) => !added.has(x));
  if (lu.exchange) {
    s.loadout = s.loadout.map((x) => (x === lu.exchange!.toId ? lu.exchange!.fromId : x));
    s.vault = s.vault.map((x) => (x === lu.exchange!.toId ? lu.exchange!.fromId : x));
  }
  return next;
}
