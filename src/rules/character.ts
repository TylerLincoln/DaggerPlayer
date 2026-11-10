// The character document stored per character (DB characters.data, local drafts, JSON export).
// Builder choices hold entry ids only; numbers on the sheet are derived (see derive.ts).
import { z } from "zod";
import { Trait, TRAITS } from "../../content/schema/index.ts";

export const Experience = z.object({ id: z.string(), name: z.string().max(80), bonus: z.number().int() });
export type Experience = z.infer<typeof Experience>;

export const QA = z.object({ question: z.string(), answer: z.string().max(4000) });

export const AncestryChoice = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("single"), id: z.string() }),
  /** mixed ancestry: top (first) feature of one ancestry + bottom (second) feature of another (SRD p. 4) */
  z.object({ kind: z.literal("mixed"), topFrom: z.string(), bottomFrom: z.string(), label: z.string().max(80).default("") }),
]);
export type AncestryChoice = z.infer<typeof AncestryChoice>;

export const Build = z.object({
  classId: z.string().nullable(),
  subclassId: z.string().nullable(),
  ancestry: AncestryChoice.nullable(),
  communityId: z.string().nullable(),
  transformationId: z.string().nullable().default(null),
  traits: z.record(Trait, z.number().int().nullable()),
  gear: z.object({
    primaryId: z.string().nullable(),
    secondaryId: z.string().nullable(),
    armorId: z.string().nullable(),
    potion: z.enum(["health", "stamina"]).nullable(),
    classItem: z.string().nullable(),
    /** free text: the item a spellcaster carries their spells in, if any (SRD p. 5) */
    spellItem: z.string().max(200).default(""),
    extraItems: z.string().max(1000).default(""),
  }),
  experiences: z.array(Experience),
  background: z.array(QA),
  connections: z.array(QA),
  /** the two level-1 domain cards chosen at creation */
  domainCardIds: z.array(z.string()),
  /** answers to feature prompts, keyed by choice id (e.g. "clank-purpose" → experience id) */
  featureChoices: z.record(z.string(), z.string()),
  /** class-feature selections the SRD leaves open (patron, companion, …) */
  classNotes: z.string().max(4000).default(""),
});
export type Build = z.infer<typeof Build>;

export const LevelUp = z.object({
  level: z.number().int().min(2).max(10),
  /** chosen advancements this level: option id + details (traits picked, experiences picked, card id, …) */
  advancements: z.array(
    z.object({
      optionId: z.string(),
      traits: z.array(Trait).optional(),
      experienceIds: z.array(z.string()).optional(),
      cardId: z.string().optional(),
      subclassId: z.string().optional(),
      classId: z.string().optional(),
      domainId: z.string().optional(),
    }),
  ),
  /** tier achievement: the new +2 Experience at levels 2, 5, 8 */
  newExperience: Experience.optional(),
  /** the domain card every level grants (step four) */
  domainCardId: z.string().nullable(),
  /** optional exchange of a previously acquired card for one of the same level or lower */
  exchange: z.object({ fromId: z.string(), toId: z.string() }).nullable().default(null),
  /** answers for choices on cards taken this level (e.g. Vitality), merged into build.featureChoices */
  choices: z.record(z.string(), z.string()).optional(),
  /** Beastbound: the companion level-up option taken (option id; "vicious:die" or "vicious:range"; "intelligent:<experience id>") */
  companionOption: z.string().optional(),
  /** Beastbound: the companion's new +2 Experience when the PC gains one (levels 2, 5, 8) */
  companionExperience: Experience.optional(),
});
export type LevelUp = z.infer<typeof LevelUp>;

export const SheetState = z.object({
  hpMarked: z.number().int().min(0),
  stressMarked: z.number().int().min(0),
  hope: z.number().int().min(0),
  armorMarked: z.number().int().min(0),
  scars: z.number().int().min(0),
  loadout: z.array(z.string()),
  vault: z.array(z.string()),
  activePrimaryId: z.string().nullable(),
  activeSecondaryId: z.string().nullable(),
  inventoryWeaponIds: z.array(z.string()),
  armorId: z.string().nullable(),
  inventory: z.array(z.object({ id: z.string(), name: z.string(), entryId: z.string().optional(), qty: z.number().int().min(0), notes: z.string().default("") })),
  gold: z.object({ handfuls: z.number().int().min(0).max(9), bags: z.number().int().min(0).max(9), chests: z.number().int().min(0).max(1) }),
  /** class resources and per-use marks: numbers, or rolled dice for pools (Prayer Dice). Keys: resource ids, "use:<freq>:<feature>", "tokens:<cardId>" */
  resources: z.record(z.string(), z.union([z.number().int(), z.array(z.number().int())])),
  conditions: z.array(z.string()),
  /** temporary effects; `until` makes them expire at the next rest or long rest */
  effects: z.array(z.object({ id: z.string(), label: z.string(), on: z.boolean(), until: z.enum(["rest", "long-rest"]).nullable().default(null) })),
  beastformId: z.string().nullable(),
  /** Druid Evolution: the trait raised by +1 until the Beastform drops */
  beastformEvolutionTrait: Trait.nullable().default(null),
  /** Beastbound Ranger companion (SRD p. 21) */
  companion: z
    .object({
      name: z.string().max(80),
      kind: z.string().max(120),
      experiences: z.array(Experience),
      attack: z.string().max(200),
      damageType: z.enum(["phy", "mag"]),
      /** starting Stress slots: printed on the companion sheet, not in SRD 2.0, so entered by the player */
      baseStress: z.number().int().min(0).max(12).nullable(),
      stressMarked: z.number().int().min(0),
    })
    .nullable()
    .default(null),
  /** short rests taken in a row; three force a long rest (SRD p. 52) */
  rests: z.object({ shortInARow: z.number().int().min(0) }).default({ shortInARow: 0 }),
});
export type SheetState = z.infer<typeof SheetState>;

export const CharacterDoc = z.object({
  schemaVersion: z.literal(1),
  id: z.string().uuid(),
  packs: z.array(z.string()).min(1),
  identity: z.object({ name: z.string().max(120), pronouns: z.string().max(40), description: z.string().max(4000) }),
  build: Build,
  /** set when the builder is finished; the sheet is usable from then on */
  finishedAt: z.string().nullable(),
  levelUps: z.array(LevelUp),
  state: SheetState,
  notes: z.object({ session: z.string(), background: z.string(), connections: z.string() }),
});
export type CharacterDoc = z.infer<typeof CharacterDoc>;

const uuid = () => crypto.randomUUID();

export function emptyTraits(): Record<Trait, number | null> {
  return Object.fromEntries(TRAITS.map((t) => [t, null])) as Record<Trait, number | null>;
}

export function newCharacter(packs: string[] = ["srd"]): CharacterDoc {
  return {
    schemaVersion: 1,
    id: uuid(),
    packs,
    identity: { name: "", pronouns: "", description: "" },
    build: {
      classId: null,
      subclassId: null,
      ancestry: null,
      communityId: null,
      transformationId: null,
      traits: emptyTraits(),
      gear: { primaryId: null, secondaryId: null, armorId: null, potion: null, classItem: null, spellItem: "", extraItems: "" },
      experiences: [
        { id: uuid(), name: "", bonus: 2 },
        { id: uuid(), name: "", bonus: 2 },
      ],
      background: [],
      connections: [],
      domainCardIds: [],
      featureChoices: {},
      classNotes: "",
    },
    finishedAt: null,
    levelUps: [],
    state: {
      hpMarked: 0,
      stressMarked: 0,
      hope: 2,
      armorMarked: 0,
      scars: 0,
      loadout: [],
      vault: [],
      activePrimaryId: null,
      activeSecondaryId: null,
      inventoryWeaponIds: [],
      armorId: null,
      inventory: [],
      gold: { handfuls: 0, bags: 0, chests: 0 },
      resources: {},
      conditions: [],
      effects: [],
      beastformId: null,
      beastformEvolutionTrait: null,
      companion: null,
      rests: { shortInARow: 0 },
    },
    notes: { session: "", background: "", connections: "" },
  };
}
