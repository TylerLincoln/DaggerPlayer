// Computes every number on the sheet from the character's choices and the content packs.
// Pure: no React, no storage. Each stat keeps a list of contributions so the UI can explain it
// ("Evasion 11 = Ranger 12 − Chainmail Armor 1"), and the builder can preview "+1 Evasion".
import { TRAITS, type Entry, type EntryOf, type Feature, type Modifier, type Trait } from "../../content/schema/index.ts";
import type { CharacterDoc } from "./character.ts";

export interface Lookup {
  get(id: string | null | undefined): Entry | undefined;
}

export interface Part {
  source: string;
  value: number;
}
export interface Stat {
  total: number;
  parts: Part[];
  /** the total hit a rules cap (e.g. HP 12) */
  capped?: boolean;
}

export interface DerivedResource {
  id: string;
  name: string;
  kind: "counter" | "die" | "die-value" | "dice-pool";
  /** counter max; dice-pool size; die-value: the die's highest face */
  max: number;
  start?: number;
  die?: string;
  resetOn?: "short-rest" | "long-rest" | "session" | "never";
  source: string;
}

export interface DerivedCompanion {
  name: string;
  evasion: Stat;
  /** null until the player enters the companion's starting Stress (not in SRD 2.0) */
  stressMax: Stat | null;
  die: string;
  range: string;
  experiences: { id: string; name: string; bonus: number }[];
  options: string[];
}

export interface Derived {
  level: number;
  tier: number;
  proficiency: Stat;
  traits: Record<Trait, Stat>;
  evasion: Stat;
  hpMax: Stat;
  stressMax: Stat;
  hopeMax: number;
  armorScore: Stat;
  thresholds: { major: Stat; severe: Stat };
  armored: boolean;
  experiences: { id: string; name: string; bonus: Stat }[];
  spellcastTraits: Trait[];
  domainIds: string[];
  /** features the character has, with where each came from */
  features: { source: string; feature: Feature }[];
  /** counters and dice the sheet tracks (Favor, Prayer Dice, …) */
  resources: DerivedResource[];
  /** the Beastform the character is in, if any */
  beastform: EntryOf<"beastform"> | null;
  companion: DerivedCompanion | null;
}

export const HP_MAX = 12; // SRD p. 50
export const STRESS_MAX = 12; // SRD p. 50
export const HOPE_MAX = 6; // SRD p. 49
export const ARMOR_SCORE_MAX = 12; // SRD p. 72
export const BASE_STRESS = 6; // SRD p. 4
export const ACHIEVEMENT_LEVELS = [2, 5, 8]; // SRD p. 53

export const tierOf = (level: number) => (level <= 1 ? 1 : level <= 4 ? 2 : level <= 7 ? 3 : 4);

const stat = (source: string, value: number): Stat => ({ total: value, parts: [{ source, value }] });
const add = (s: Stat, source: string, value: number) => {
  if (!value) return;
  s.total += value;
  s.parts.push({ source, value });
};
const cap = (s: Stat, max: number) => {
  if (s.total > max) {
    s.total = max;
    s.capped = true;
  }
};

/** Weapons and armor in use: the sheet's active gear once finished, the builder's picks before that. */
export function equipped(c: CharacterDoc) {
  return c.finishedAt
    ? { primaryId: c.state.activePrimaryId, secondaryId: c.state.activeSecondaryId, armorId: c.state.armorId }
    : { primaryId: c.build.gear.primaryId, secondaryId: c.build.gear.secondaryId, armorId: c.build.gear.armorId };
}

/** Domain cards whose effects apply: the loadout once finished, the starting picks before that. */
export function activeCards(c: CharacterDoc): string[] {
  return c.finishedAt ? c.state.loadout : c.build.domainCardIds;
}

/** Every domain card the character holds (starting cards, level-up cards, advancement cards, after exchanges). */
export function ownedCards(c: CharacterDoc): string[] {
  let cards = [...c.build.domainCardIds];
  for (const lu of c.levelUps) {
    for (const a of lu.advancements) if (a.optionId === "domain-card" && a.cardId) cards.push(a.cardId);
    if (lu.domainCardId) cards.push(lu.domainCardId);
    if (lu.exchange) cards = cards.map((x) => (x === lu.exchange!.fromId ? lu.exchange!.toId : x));
  }
  return cards;
}

/** Selected option ids for a choice (stored comma-separated in build.featureChoices). */
export const chosen = (c: CharacterDoc, choiceId: string): string[] => (c.build.featureChoices[choiceId] ?? "").split(",").filter(Boolean);

const DIE_STEPS = ["d4", "d6", "d8", "d10", "d12", "d20"];
const RANGE_STEPS = ["Melee", "Very Close", "Close", "Far", "Very Far"];
export const COMPANION_START = { evasion: 10, die: "d6", range: "Melee" }; // SRD p. 21

/** Ancestry features the character has (two for a single ancestry; top + bottom for a mixed one). */
export function ancestryFeatures(c: CharacterDoc, lookup: Lookup): { source: string; feature: Feature }[] {
  const a = c.build.ancestry;
  if (!a) return [];
  if (a.kind === "single") {
    const e = lookup.get(a.id);
    return e?.type === "ancestry" ? e.features.map((f) => ({ source: e.name, feature: f })) : [];
  }
  const top = lookup.get(a.topFrom);
  const bottom = lookup.get(a.bottomFrom);
  return [
    ...(top?.type === "ancestry" ? [{ source: top.name, feature: top.features[0] }] : []),
    ...(bottom?.type === "ancestry" ? [{ source: bottom.name, feature: bottom.features[1] }] : []),
  ];
}

/** How many upgraded subclass cards each subclass has received (0 = foundation only). */
function subclassUpgrades(c: CharacterDoc): Map<string, number> {
  const m = new Map<string, number>();
  for (const lu of c.levelUps)
    for (const a of lu.advancements) if (a.optionId === "subclass" && a.subclassId) m.set(a.subclassId, (m.get(a.subclassId) ?? 0) + 1);
  return m;
}

export function derive(c: CharacterDoc, lookup: Lookup): Derived {
  const level = 1 + c.levelUps.length;
  const tier = tierOf(level);
  const cls = lookup.get(c.build.classId) as EntryOf<"class"> | undefined;
  const sub = lookup.get(c.build.subclassId) as EntryOf<"subclass"> | undefined;
  const gear = equipped(c);
  const armor = lookup.get(gear.armorId) as EntryOf<"armor"> | undefined;
  const armored = armor?.type === "armor";

  // ---- features the character has ----
  const features: Derived["features"] = [];
  const push = (source: string, fs: Feature[] | undefined) => fs?.forEach((feature) => features.push({ source, feature }));
  if (cls?.type === "class") push(cls.name, [cls.hopeFeature, ...cls.classFeatures]);
  const upgrades = subclassUpgrades(c);
  const subclasses = [sub, ...c.levelUps.flatMap((lu) => lu.advancements.filter((a) => a.optionId === "multiclass").map((a) => lookup.get(a.subclassId)))].filter(
    (s): s is EntryOf<"subclass"> => s?.type === "subclass",
  );
  for (const s of subclasses) {
    const n = upgrades.get(s.id) ?? 0;
    push(`${s.name} (foundation)`, s.foundation);
    if (n >= 1) push(`${s.name} (specialization)`, s.specialization);
    if (n >= 2) push(`${s.name} (mastery)`, s.mastery);
  }
  for (const lu of c.levelUps)
    for (const a of lu.advancements)
      if (a.optionId === "multiclass") {
        const mc = lookup.get(a.classId);
        if (mc?.type === "class") push(`${mc.name} (multiclass)`, mc.classFeatures);
      }
  for (const af of ancestryFeatures(c, lookup)) features.push(af);
  const community = lookup.get(c.build.communityId);
  if (community?.type === "community") push(community.name, [community.feature]);
  const transformation = lookup.get(c.build.transformationId);
  if (transformation?.type === "transformation") push(transformation.name, transformation.features);

  // ---- base stats ----
  const traits = Object.fromEntries(TRAITS.map((t) => [t, stat("Assigned", c.build.traits[t] ?? 0)])) as Record<Trait, Stat>;
  const evasion = stat(cls ? `${cls.name} starting Evasion` : "No class", cls?.startingEvasion ?? 0);
  const hpMax = stat(cls ? `${cls.name} starting HP` : "No class", cls?.startingHp ?? 0);
  const stressMax = stat("Starting Stress", BASE_STRESS);
  const proficiency = stat("Starting Proficiency", 1);
  const armorScore = stat(armored ? `${armor.name} base score` : "Unarmored", armored ? armor.baseScore : 0);
  // SRD p. 72: thresholds = armor base + level; unarmored, Major = level and Severe = 2 × level
  const major = armored ? stat(`${armor.name} base`, armor.baseThresholds.major) : stat("Unarmored (level)", level);
  const severe = armored ? stat(`${armor.name} base`, armor.baseThresholds.severe) : stat("Unarmored (2 × level)", 2 * level);
  if (armored) {
    add(major, "Level", level);
    add(severe, "Level", level);
  }

  // ---- Beastform (Druid): active only on a finished sheet ----
  const bf = c.finishedAt ? lookup.get(c.state.beastformId) : undefined;
  const beastform = bf?.type === "beastform" ? bf : null;

  // ---- modifiers ----
  const apply = (source: string, mods: Modifier[] | undefined) => {
    for (const m of mods ?? []) {
      if (m.when === "armored" && !armored) continue;
      if (m.when === "unarmed" && (gear.primaryId || gear.secondaryId)) continue;
      if (m.when === "beastform" && !beastform) continue;
      switch (m.target) {
        case "evasion": add(evasion, source, m.value); break;
        case "hp": add(hpMax, source, m.value); break;
        case "stress": add(stressMax, source, m.value); break;
        case "armorScore": add(armorScore, source, m.value); break;
        case "majorThreshold": add(major, source, m.value); break;
        case "severeThreshold": add(severe, source, m.value); break;
        case "proficiency": add(proficiency, source, m.value); break;
        default:
          if (m.target.startsWith("trait:")) add(traits[m.target.slice(6) as Trait], source, m.value);
      }
    }
  };
  for (const { source, feature } of features) apply(`${source}: ${feature.name}`, feature.modifiers);
  for (const id of [gear.primaryId, gear.secondaryId, gear.armorId]) {
    const e = lookup.get(id);
    if ((e?.type === "weapon" || e?.type === "armor") && e.feature) apply(`${e.name}: ${e.feature.name}`, e.feature.modifiers);
  }
  for (const id of activeCards(c)) {
    const e = lookup.get(id);
    if (e?.type === "domain-card") apply(e.name, e.modifiers);
  }
  // choices with their own effects: on features, and on cards held anywhere (e.g. Vitality stays in the vault)
  const optionMods = (source: string, choices: Feature["choices"]) => {
    for (const ch of choices ?? []) {
      if (!Array.isArray(ch.options)) continue;
      const picked = chosen(c, ch.id);
      for (const o of ch.options) if (typeof o === "object" && picked.includes(o.id)) apply(`${source}: ${o.label}`, o.modifiers);
    }
  };
  for (const { source, feature } of features) optionMods(`${source}: ${feature.name}`, feature.choices);
  const owned = c.finishedAt ? ownedCards(c) : c.build.domainCardIds;
  for (const id of owned) {
    const e = lookup.get(id);
    if (e?.type === "domain-card") optionMods(e.name, e.choices);
  }
  if (beastform) {
    if (beastform.traitBonus) add(traits[beastform.traitBonus.trait], `Beastform: ${beastform.name}`, beastform.traitBonus.value);
    if (beastform.evasionBonus) add(evasion, `Beastform: ${beastform.name}`, beastform.evasionBonus);
    if (c.state.beastformEvolutionTrait) add(traits[c.state.beastformEvolutionTrait], "Evolution", 1);
  }

  // ---- experiences ----
  const experiences = [...c.build.experiences, ...c.levelUps.flatMap((lu) => (lu.newExperience ? [lu.newExperience] : []))].map((x) => ({
    id: x.id,
    name: x.name,
    bonus: stat("Base", x.bonus),
  }));
  const exp = (id: string) => experiences.find((x) => x.id === id);
  const clank = c.build.featureChoices["clank-purpose"];
  if (clank && features.some((f) => f.feature.choices?.some((ch) => ch.id === "clank-purpose"))) {
    const x = exp(clank);
    if (x) add(x.bonus, "Clank: Purposeful Design", 1);
  }

  // Master of the Craft: "+2 to two Experiences" or "+3 to one", stored as "two:<id>,<id>" / "one:<id>"
  if (owned.includes("srd/domain-card/master-of-the-craft")) {
    const [mode, ids = ""] = (c.build.featureChoices["master-of-the-craft"] ?? "").split(":");
    for (const id of ids.split(",").filter(Boolean)) {
      const x = exp(id);
      if (x) add(x.bonus, "Master of the Craft", mode === "one" ? 3 : 2);
    }
  }

  // ---- level-ups (SRD pp. 53–54) ----
  for (const lu of c.levelUps) {
    const src = `Level ${lu.level}`;
    if (ACHIEVEMENT_LEVELS.includes(lu.level)) add(proficiency, `${src} tier achievement`, 1);
    for (const a of lu.advancements) {
      switch (a.optionId) {
        case "traits": a.traits?.forEach((t) => add(traits[t], `${src} advancement`, 1)); break;
        case "hp": add(hpMax, `${src} advancement`, 1); break;
        case "stress": add(stressMax, `${src} advancement`, 1); break;
        case "evasion": add(evasion, `${src} advancement`, 1); break;
        case "proficiency": add(proficiency, `${src} advancement`, 1); break;
        case "experiences": a.experienceIds?.forEach((id) => { const x = exp(id); if (x) add(x.bonus, `${src} advancement`, 1); }); break;
      }
    }
  }

  cap(hpMax, HP_MAX);
  cap(stressMax, STRESS_MAX);
  cap(armorScore, ARMOR_SCORE_MAX);

  // ---- resources ----
  const spell = Math.max(0, ...subclasses.map((s) => (s.spellcastTrait ? traits[s.spellcastTrait].total : 0)));
  const resources: DerivedResource[] = [];
  for (const { source, feature } of features)
    for (const r of feature.resources ?? []) {
      const die = level >= 5 && r.dieAtLevel5 ? r.dieAtLevel5 : r.die;
      const max = typeof r.max === "number" ? r.max : r.max === "spellcast" ? spell : r.max === "tier" ? tier : r.max === "level" ? level : proficiency.total;
      resources.push({ id: r.id, name: r.name, kind: r.kind, max: r.kind === "die-value" ? Number(die?.slice(1) ?? 0) : max, start: r.start, die, resetOn: r.resetOn, source: `${source}: ${feature.name}` });
    }

  // ---- companion (Beastbound, SRD pp. 21–22) ----
  let companion: DerivedCompanion | null = null;
  const beastbound = subclasses.some((s) => s.id === "srd/subclass/beastbound");
  if (beastbound && c.state.companion) {
    const k = c.state.companion;
    const options = c.levelUps.map((lu) => lu.companionOption).filter((o): o is string => !!o);
    const evasionC = stat("Companion starting Evasion", COMPANION_START.evasion);
    for (const o of options) if (o === "aware") add(evasionC, "Aware", 2);
    const stressC = k.baseStress === null ? null : stat("Starting Stress (companion sheet)", k.baseStress);
    for (const o of options) if (o === "resilient" && stressC) add(stressC, "Resilient", 1);
    let die = DIE_STEPS.indexOf(COMPANION_START.die);
    let range = RANGE_STEPS.indexOf(COMPANION_START.range);
    for (const o of options) {
      if (o === "vicious:die") die = Math.min(die + 1, DIE_STEPS.length - 1);
      if (o === "vicious:range") range = Math.min(range + 1, RANGE_STEPS.length - 1);
    }
    const xps = [...k.experiences, ...c.levelUps.flatMap((lu) => (lu.companionExperience ? [lu.companionExperience] : []))].map((x) => ({ ...x }));
    for (const o of options) if (o.startsWith("intelligent:")) { const x = xps.find((e) => e.id === o.slice(12)); if (x) x.bonus += 1; }
    companion = { name: k.name, evasion: evasionC, stressMax: stressC, die: DIE_STEPS[die], range: RANGE_STEPS[range], experiences: xps, options };
  }
  const lightInTheDark = companion?.options.filter((o) => o === "light-in-the-dark").length ?? 0;

  const domainIds = [...(cls?.type === "class" ? cls.domainIds : [])];
  for (const lu of c.levelUps) for (const a of lu.advancements) if (a.optionId === "multiclass" && a.domainId) domainIds.push(a.domainId);

  return {
    level,
    tier,
    proficiency,
    traits,
    evasion,
    hpMax,
    stressMax,
    // "Light in the Dark": an additional Hope slot (companion option, SRD p. 22)
    hopeMax: Math.max(0, HOPE_MAX + lightInTheDark - c.state.scars),
    armorScore,
    thresholds: { major, severe },
    armored,
    experiences,
    spellcastTraits: [...new Set(subclasses.map((s) => s.spellcastTrait).filter((t): t is Trait => !!t))],
    domainIds,
    features,
    resources,
    beastform,
    companion,
  };
}

export interface StatChange {
  label: string;
  before: number;
  after: number;
}

/** Differences between two derived sheets, for "+1 Evasion" style previews. */
export function diffDerived(a: Derived, b: Derived): StatChange[] {
  const out: StatChange[] = [];
  const cmp = (label: string, x: number, y: number) => x !== y && out.push({ label, before: x, after: y });
  cmp("Evasion", a.evasion.total, b.evasion.total);
  cmp("Hit Points", a.hpMax.total, b.hpMax.total);
  cmp("Stress", a.stressMax.total, b.stressMax.total);
  cmp("Armor Score", a.armorScore.total, b.armorScore.total);
  cmp("Major threshold", a.thresholds.major.total, b.thresholds.major.total);
  cmp("Severe threshold", a.thresholds.severe.total, b.thresholds.severe.total);
  cmp("Proficiency", a.proficiency.total, b.proficiency.total);
  for (const t of TRAITS) cmp(t.charAt(0).toUpperCase() + t.slice(1), a.traits[t].total, b.traits[t].total);
  return out;
}

export const formatChange = (c: StatChange) => {
  const d = c.after - c.before;
  return `${d > 0 ? "+" : "−"}${Math.abs(d)} ${c.label}`;
};
