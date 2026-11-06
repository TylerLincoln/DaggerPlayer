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

  // ---- modifiers ----
  const apply = (source: string, mods: Modifier[] | undefined) => {
    for (const m of mods ?? []) {
      if (m.when === "armored" && !armored) continue;
      if (m.when === "beastform") continue; // Beastform bonuses are applied by the sheet while transformed
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
    hopeMax: Math.max(0, HOPE_MAX - c.state.scars),
    armorScore,
    thresholds: { major, severe },
    armored,
    experiences,
    spellcastTraits: [...new Set(subclasses.map((s) => s.spellcastTrait).filter((t): t is Trait => !!t))],
    domainIds,
    features,
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
