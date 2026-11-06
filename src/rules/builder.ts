// Character creation rules (SRD pp. 4–6): what each builder step needs, and the starting sheet.
import { TRAITS, type EntryOf } from "../../content/schema/index.ts";
import type { CharacterDoc } from "./character.ts";
import { derive, type Lookup } from "./derive.ts";
import { isValidSpread } from "./traits.ts";

export const BUILDER_STEPS = [
  { id: "class", label: "Class" },
  { id: "heritage", label: "Heritage" },
  { id: "traits", label: "Traits" },
  { id: "gear", label: "Gear" },
  { id: "background", label: "Background" },
  { id: "cards", label: "Domain cards" },
  { id: "connections", label: "Connections" },
  { id: "review", label: "Review" },
] as const;
export type StepId = (typeof BUILDER_STEPS)[number]["id"];

export interface BuildIssue {
  step: StepId;
  severity: "error" | "warning";
  message: string;
}

export const STARTING_ITEMS = ["Torch", "50 feet of rope", "Basic supplies"]; // SRD p. 5
export const POTIONS = { health: "Minor Health Potion", stamina: "Minor Stamina Potion" } as const;

export function validateBuild(c: CharacterDoc, lookup: Lookup): BuildIssue[] {
  const out: BuildIssue[] = [];
  const err = (step: StepId, message: string) => out.push({ step, severity: "error", message });
  const warn = (step: StepId, message: string) => out.push({ step, severity: "warning", message });
  const b = c.build;
  const missing = (id: string | null | undefined) => !!id && !lookup.get(id);

  // ---- class ----
  const cls = lookup.get(b.classId);
  if (!b.classId) err("class", "Choose a class.");
  else if (cls?.type !== "class") err("class", "The chosen class isn't available. Is its content pack turned on?");
  const sub = lookup.get(b.subclassId);
  if (!b.subclassId) err("class", "Choose a subclass.");
  else if (sub?.type !== "subclass") err("class", "The chosen subclass isn't available.");
  else if (cls?.type === "class" && sub.classId !== cls.id) err("class", `${sub.name} is not a ${cls.name} subclass.`);

  // ---- heritage ----
  const a = b.ancestry;
  if (!a) err("heritage", "Choose an ancestry (or a mixed ancestry).");
  else if (a.kind === "single") {
    if (lookup.get(a.id)?.type !== "ancestry") err("heritage", "The chosen ancestry isn't available.");
  } else {
    if (!a.topFrom || !a.bottomFrom) err("heritage", "A mixed ancestry needs a top feature from one ancestry and a bottom feature from another.");
    else if (a.topFrom === a.bottomFrom) err("heritage", "For a mixed ancestry, take the two features from different ancestries.");
    else if (lookup.get(a.topFrom)?.type !== "ancestry" || lookup.get(a.bottomFrom)?.type !== "ancestry") err("heritage", "A chosen ancestry isn't available.");
  }
  if (!b.communityId) err("heritage", "Choose a community.");
  else if (lookup.get(b.communityId)?.type !== "community") err("heritage", "The chosen community isn't available.");
  if (missing(b.transformationId)) err("heritage", "The chosen transformation isn't available.");

  // ---- traits ----
  const assigned = TRAITS.filter((t) => b.traits[t] !== null).length;
  if (assigned < TRAITS.length) err("traits", `Assign all six traits (${assigned} of 6 done).`);
  else if (!isValidSpread(b.traits)) err("traits", "Traits must use +2, +1, +1, +0, +0 and −1 exactly once each.");

  // ---- gear ----
  const g = b.gear;
  const derived = derive(c, lookup);
  const primary = lookup.get(g.primaryId) as EntryOf<"weapon"> | undefined;
  const secondary = lookup.get(g.secondaryId) as EntryOf<"weapon"> | undefined;
  const checkWeapon = (w: EntryOf<"weapon"> | undefined, id: string | null, category: "primary" | "secondary") => {
    if (!id) return;
    if (w?.type !== "weapon") return err("gear", `The chosen ${category} weapon isn't available.`);
    if (w.category !== category) err("gear", `${w.name} is a ${w.category} weapon.`);
    if (w.tier !== 1) err("gear", `${w.name} is a Tier ${w.tier} weapon; start with Tier 1.`);
    if (w.damage.type === "mag" && derived.spellcastTraits.length === 0) err("gear", `${w.name} deals magic damage, which needs a Spellcast trait (from your subclass).`);
  };
  checkWeapon(primary, g.primaryId, "primary");
  checkWeapon(secondary, g.secondaryId, "secondary");
  if (!g.primaryId) warn("gear", "No primary weapon chosen.");
  if (primary?.type === "weapon" && primary.burden === 2 && g.secondaryId) err("gear", `${primary.name} is two-handed, so you can't also carry a secondary weapon.`);
  if (secondary?.type === "weapon" && secondary.burden === 2) err("gear", `${secondary.name} is two-handed; a secondary weapon must be one-handed.`);
  if (primary?.type === "weapon" && primary.burden === 1 && !g.secondaryId) warn("gear", "With a one-handed primary weapon you can also take a one-handed secondary weapon.");
  if (!g.armorId) err("gear", "Choose a set of Tier 1 armor.");
  else {
    const ar = lookup.get(g.armorId);
    if (ar?.type !== "armor") err("gear", "The chosen armor isn't available.");
    else if (ar.tier !== 1) err("gear", `${ar.name} is Tier ${ar.tier}; start with Tier 1 armor.`);
  }
  if (!g.potion) err("gear", "Choose a Minor Health Potion or a Minor Stamina Potion.");
  if (!g.classItem) err("gear", "Choose one of your class items.");
  else if (cls?.type === "class" && !cls.classItems.includes(g.classItem)) err("gear", "The class item doesn't belong to your class.");

  // ---- background & experiences ----
  if (!c.identity.name.trim()) err("background", "Give your character a name.");
  const xps = b.experiences;
  if (xps.length !== 2) err("background", "Create exactly two Experiences.");
  xps.forEach((x, i) => !x.name.trim() && err("background", `Name Experience ${i + 1}.`));
  if (xps.some((x) => x.bonus !== 2)) err("background", "Starting Experiences are +2 each.");
  const names = xps.map((x) => x.name.trim().toLowerCase()).filter(Boolean);
  if (new Set(names).size !== names.length) err("background", "Your two Experiences should be different.");
  if (!b.background.some((q) => q.answer.trim())) warn("background", "No background questions answered yet (optional).");
  for (const { feature } of derived.features)
    for (const ch of feature.choices ?? [])
      if (!b.featureChoices[ch.id]) err("background", `${feature.name}: ${ch.prompt}`);
      else if (typeof ch.options === "object" && !Array.isArray(ch.options) && ch.options.type === "experience" && !xps.some((x) => x.id === b.featureChoices[ch.id]))
        err("background", `${feature.name}: pick one of your Experiences.`);

  // ---- domain cards ----
  const domains: string[] = cls?.type === "class" ? cls.domainIds : [];
  if (b.domainCardIds.length !== 2) err("cards", `Choose two level 1 domain cards (${b.domainCardIds.length} of 2).`);
  if (new Set(b.domainCardIds).size !== b.domainCardIds.length) err("cards", "Choose two different cards.");
  for (const id of b.domainCardIds) {
    const card = lookup.get(id);
    if (card?.type !== "domain-card") err("cards", "A chosen card isn't available.");
    else {
      if (card.level !== 1) err("cards", `${card.name} is level ${card.level}; starting cards are level 1.`);
      if (!domains.includes(card.domainId)) err("cards", `${card.name} isn't from one of your class's domains.`);
    }
  }

  // ---- connections ----
  if (!b.connections.some((q) => q.answer.trim())) warn("connections", "No connections noted yet (optional; they're usually made at the table).");

  return out;
}

export const canFinish = (issues: BuildIssue[]) => !issues.some((i) => i.severity === "error");

/** Turn a finished build into a playable sheet: starting inventory, gold, Hope, loadout, equipped gear (SRD pp. 4–5). */
export function finishBuild(c: CharacterDoc, lookup: Lookup, now = new Date()): CharacterDoc {
  const issues = validateBuild(c, lookup);
  if (!canFinish(issues)) throw new Error(`build is incomplete: ${issues.filter((i) => i.severity === "error").map((i) => i.message).join(" ")}`);
  const g = c.build.gear;
  const item = (name: string, entryId?: string) => ({ id: crypto.randomUUID(), name, qty: 1, notes: "", ...(entryId ? { entryId } : {}) });
  const potionName = POTIONS[g.potion!];
  const potionEntry = [...((lookup as { all?: (t: "consumable") => EntryOf<"consumable">[] }).all?.("consumable") ?? [])].find((e) => e.name === potionName);
  const extras = g.extraItems.split("\n").map((s) => s.trim()).filter(Boolean);
  return {
    ...c,
    finishedAt: now.toISOString(),
    state: {
      ...c.state,
      hpMarked: 0,
      stressMarked: 0,
      hope: 2,
      armorMarked: 0,
      loadout: [...c.build.domainCardIds],
      vault: [],
      activePrimaryId: g.primaryId,
      activeSecondaryId: g.secondaryId,
      armorId: g.armorId,
      inventory: [
        ...STARTING_ITEMS.map((n) => item(n)),
        item(potionName, potionEntry?.id),
        item(g.classItem!),
        ...(g.spellItem.trim() ? [item(g.spellItem.trim())] : []),
        ...extras.map((n) => item(n)),
      ],
      gold: { handfuls: 1, bags: 0, chests: 0 },
    },
  };
}
