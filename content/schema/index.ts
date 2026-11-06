// Content schemas. One source of truth: TS types are inferred from these Zod schemas,
// and `npm run content:jsonschema` exports JSON Schema for homebrew authors.
import { z } from "zod";

// ---------- shared ----------

export const TRAITS = ["agility", "strength", "finesse", "instinct", "presence", "knowledge"] as const;
export const Trait = z.enum(TRAITS);
export type Trait = z.infer<typeof Trait>;

export const RANGES = ["melee", "very-close", "close", "far", "very-far"] as const;
export const Range = z.enum(RANGES);

export const DamageType = z.enum(["phy", "mag", "phy/mag"]);
export const Tier = z.number().int().min(1).max(4);
export const Level = z.number().int().min(1).max(10);

/** `<pack>/<type>/<slug>`, e.g. `srd/class/warlock`, `hb-1a2b…/weapon/sunblade`. */
export const EntryId = z.string().regex(/^[a-z0-9-]+\/[a-z-]+\/[a-z0-9-]+$/, "id must be <pack>/<type>/<slug>");
export const PackId = z.string().regex(/^[a-z0-9-]+$/);

export const Source = z.object({
  kind: z.enum(["srd", "pgc", "homebrew"]),
  document: z.string(), // "Daggerheart SRD 2.0", or the homebrew pack name
  page: z.number().int().positive().optional(),
  pageEnd: z.number().int().positive().optional(),
});
export type Source = z.infer<typeof Source>;

/**
 * Light markdown (**bold**, _italic_, "- " bullets, blank-line paragraphs) plus inline tags:
 *   {{term:<glossary-slug>|label}}   rules term (tooltip + link)
 *   {{ref:<entry-id>|label}}         link to another entry
 */
export const RichText = z.string();

export const Modifier = z.object({
  target: z.union([
    z.enum(["evasion", "hp", "stress", "hope", "armorScore", "majorThreshold", "severeThreshold", "proficiency", "attack", "damage"]),
    z.templateLiteral(["trait:", Trait]),
  ]),
  value: z.number().int(),
  /** always | while this item is equipped | while in Beastform | while wearing any armor */
  when: z.enum(["always", "equipped", "beastform", "armored"]).default("always"),
});
export type Modifier = z.infer<typeof Modifier>;

export const Resource = z.object({
  id: z.string(),
  name: z.string(),
  /** a number, or a stat the max follows */
  max: z.union([z.number().int().positive(), z.enum(["spellcast", "tier", "level", "proficiency"])]),
  start: z.number().int().optional(),
  die: z.string().optional(), // e.g. Patron Die "d6"
  resetOn: z.enum(["short-rest", "long-rest", "session", "never"]).optional(),
});

export const Choice = z.object({
  id: z.string(),
  prompt: z.string(),
  count: z.number().int().positive().default(1),
  options: z.union([z.array(z.string()), z.literal("free-text"), z.object({ type: z.string(), filter: z.record(z.string(), z.unknown()).optional() })]),
});

export const Feature = z.object({
  name: z.string(),
  text: RichText,
  /** "evolution": adversary features that transform the stat block (Hope & Fear adversaries) */
  kind: z.enum(["passive", "action", "reaction", "evolution"]).optional(),
  modifiers: z.array(Modifier).optional(),
  resources: z.array(Resource).optional(),
  choices: z.array(Choice).optional(),
  /** GM prompt questions printed under environment features */
  questions: z.array(z.string()).optional(),
});
export type Feature = z.infer<typeof Feature>;

const base = {
  id: EntryId,
  name: z.string().min(1),
  pack: PackId,
  source: Source,
  tags: z.array(z.string()).optional(),
};

// ---------- character options ----------

export const Domain = z.object({
  ...base,
  type: z.literal("domain"),
  text: RichText,
  icon: z.string().optional(), // path to an icon extracted from the SRD
});

export const DomainCard = z.object({
  ...base,
  type: z.literal("domain-card"),
  domainId: EntryId,
  level: Level,
  cardType: z.enum(["ability", "spell", "grimoire"]),
  recallCost: z.number().int().min(0),
  text: RichText,
  features: z.array(Feature).optional(), // grimoires list several named spells
  /** permanent stat changes while the card is in the loadout */
  modifiers: z.array(Modifier).optional(),
});

export const Class = z.object({
  ...base,
  type: z.literal("class"),
  text: RichText,
  domainIds: z.tuple([EntryId, EntryId]),
  startingEvasion: z.number().int(),
  startingHp: z.number().int(),
  classItems: z.array(z.string()).min(1),
  hopeFeature: Feature,
  classFeatures: z.array(Feature).min(1),
  subclassIds: z.array(EntryId).length(2),
  backgroundQuestions: z.array(z.string()),
  connectionQuestions: z.array(z.string()),
  /** extra class-specific reference lists (e.g. warlock spheres of influence) */
  lists: z.array(z.object({ title: z.string(), items: z.array(z.string()) })).optional(),
});

export const Subclass = z.object({
  ...base,
  type: z.literal("subclass"),
  classId: EntryId,
  text: RichText,
  spellcastTrait: Trait.nullable(),
  foundation: z.array(Feature).min(1),
  specialization: z.array(Feature).min(1),
  mastery: z.array(Feature).min(1),
});

export const Ancestry = z.object({
  ...base,
  type: z.literal("ancestry"),
  text: RichText,
  /** [top, bottom]: mixed ancestry takes the top feature of one and the bottom of another */
  features: z.tuple([Feature, Feature]),
});

export const Community = z.object({
  ...base,
  type: z.literal("community"),
  text: RichText,
  adjectives: z.array(z.string()),
  feature: Feature,
});

export const Transformation = z.object({
  ...base,
  type: z.literal("transformation"),
  text: RichText,
  features: z.array(Feature).min(1),
  questions: z.array(z.string()),
});

export const Beastform = z.object({
  ...base,
  type: z.literal("beastform"),
  tier: Tier,
  examples: z.string(),
  /** null for upgrade forms (Legendary/Mythic Beast, Hybrid) whose stats come from the forms they build on */
  traitBonus: z.object({ trait: Trait, value: z.number().int() }).nullable(),
  evasionBonus: z.number().int().nullable(),
  attack: z.object({ range: Range, trait: Trait, damage: z.string(), damageType: DamageType }).nullable(),
  advantages: z.array(z.string()),
  features: z.array(Feature).min(1),
});

// ---------- equipment ----------

export const Weapon = z.object({
  ...base,
  type: z.literal("weapon"),
  tier: Tier,
  category: z.enum(["primary", "secondary"]),
  group: z.enum(["physical", "magic", "combat-wheelchair"]),
  /** "spellcast": use the subclass Spellcast trait (arcane-frame wheelchairs) */
  trait: z.union([Trait, z.literal("spellcast")]),
  range: Range,
  damage: z.object({ dice: z.string().regex(/^d(4|6|8|10|12|20)$/), bonus: z.number().int(), type: DamageType }),
  burden: z.union([z.literal(1), z.literal(2)]),
  feature: Feature.nullable(),
});

export const Armor = z.object({
  ...base,
  type: z.literal("armor"),
  tier: Tier,
  baseThresholds: z.object({ major: z.number().int(), severe: z.number().int() }),
  baseScore: z.number().int(),
  feature: Feature.nullable(),
});

const lootBase = {
  ...base,
  roll: z.number().int().positive(), // number on the d12-sum table
  table: z.string(), // e.g. "Core Set Items"
  text: RichText,
};
export const Item = z.object({ ...lootBase, type: z.literal("item") });
export const Consumable = z.object({ ...lootBase, type: z.literal("consumable") });

// ---------- GM ----------

export const ADVERSARY_TYPES = ["bruiser", "horde", "leader", "minion", "ranged", "skulk", "social", "solo", "standard", "support"] as const;

export const Adversary = z.object({
  ...base,
  type: z.literal("adversary"),
  tier: Tier,
  role: z.enum(ADVERSARY_TYPES),
  hordePerHp: z.number().int().positive().optional(),
  text: RichText, // description
  motives: z.string(),
  difficulty: z.number().int(),
  /** null = "Thresholds: None" (minions). A single side can be null too (e.g. Octopus "3/None"). */
  thresholds: z.object({ major: z.number().int().nullable(), severe: z.number().int().nullable() }).nullable(),
  hp: z.number().int().nullable(),
  /** null = "Stress: None" */
  stress: z.number().int().nullable(),
  /** modifier is a signed string: "+2", "-4", or a die such as "+2d4" (Outer Realms Abomination) */
  attack: z.object({ modifier: z.string().regex(/^[+-](\d+|\d*d\d+)$/), name: z.string(), range: Range, damage: z.string() }),
  experiences: z.array(z.object({ name: z.string(), bonus: z.number().int() })),
  features: z.array(Feature),
});

export const Environment = z.object({
  ...base,
  type: z.literal("environment"),
  tier: Tier,
  envType: z.enum(["exploration", "social", "traversal", "event"]),
  text: RichText,
  impulses: z.string(),
  difficulty: z.number().int().nullable(), // some list "Special"
  difficultyNote: z.string().optional(),
  potentialAdversaries: z.string(),
  features: z.array(Feature),
});

// ---------- rules ----------

export const AdvancementOption = z.object({
  id: z.string(),
  text: z.string(),
  /**
   * Slots per tier, keyed "2" | "3" | "4"; a missing tier means the option isn't offered there.
   * Not in SRD 2.0: owner-supplied (content/srd/supplied/advancement-slots.json).
   */
  slotsByTier: z.partialRecord(z.enum(["2", "3", "4"]), z.number().int().positive()),
  /** slots marked per pick: 2 for the "black box" options (Proficiency, multiclass) */
  cost: z.union([z.literal(1), z.literal(2)]),
  minLevel: z.number().int().optional(), // multiclass from level 5
});

export const Progression = z.object({
  ...base,
  type: z.literal("progression"),
  tiers: z.array(z.object({ tier: Tier, levels: z.array(Level), achievements: RichText.nullable() })),
  advancements: z.array(AdvancementOption),
  /** where the slot counts came from */
  slotsSource: z.string(),
  companionOptions: z.array(Feature),
  text: RichText,
});

export const Condition = z.object({ ...base, type: z.literal("condition"), text: RichText });

export const GlossaryTerm = z.object({
  ...base,
  type: z.literal("glossary"),
  aliases: z.array(z.string()),
  summary: RichText, // verbatim SRD sentence used for tooltips
  sectionId: EntryId.optional(),
});

export const RulesSection = z.object({
  ...base,
  type: z.literal("rules"),
  parentId: EntryId.nullable(),
  order: z.number().int(),
  text: RichText,
});

// ---------- packs ----------

export const ENTRY_SCHEMAS = {
  domain: Domain,
  "domain-card": DomainCard,
  class: Class,
  subclass: Subclass,
  ancestry: Ancestry,
  community: Community,
  transformation: Transformation,
  beastform: Beastform,
  weapon: Weapon,
  armor: Armor,
  item: Item,
  consumable: Consumable,
  adversary: Adversary,
  environment: Environment,
  progression: Progression,
  condition: Condition,
  glossary: GlossaryTerm,
  rules: RulesSection,
} as const;
export type EntryType = keyof typeof ENTRY_SCHEMAS;
export const ENTRY_TYPES = Object.keys(ENTRY_SCHEMAS) as EntryType[];

export const Entry = z.discriminatedUnion("type", [
  Domain, DomainCard, Class, Subclass, Ancestry, Community, Transformation, Beastform,
  Weapon, Armor, Item, Consumable, Adversary, Environment, Progression, Condition, GlossaryTerm, RulesSection,
]);
export type Entry = z.infer<typeof Entry>;
export type EntryOf<K extends EntryType> = z.infer<(typeof ENTRY_SCHEMAS)[K]>;

export const PackMeta = z.object({
  id: PackId,
  name: z.string(),
  version: z.string(),
  kind: z.enum(["srd", "pgc", "homebrew"]),
  /** off unless a character turns it on */
  defaultEnabled: z.boolean(),
  /** other packs this one references */
  requires: z.array(PackId).default([]),
  attribution: z.string().optional(),
  modifications: z.array(z.string()).default([]),
});
export type PackMeta = z.infer<typeof PackMeta>;

export const Pack = z.object({ meta: PackMeta, entries: z.array(Entry) });
export type Pack = z.infer<typeof Pack>;
