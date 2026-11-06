import { describe, expect, it } from "vitest";
import type { Entry, EntryOf, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { finishBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, type LevelUp, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { type Advancement, applyLevelUp, emptyLevelUp, ownedCards, optionStatus, undoLastLevelUp, validateLevelUp } from "../src/rules/levelup.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));

function rangerL1(): CharacterDoc {
  const c = newCharacter();
  c.identity.name = "Wren";
  Object.assign(c.build, {
    classId: "srd/class/ranger", subclassId: "srd/subclass/wayfinder", ancestry: { kind: "single", id: "srd/ancestry/elf" }, communityId: "srd/community/highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    gear: { primaryId: "srd/weapon/shortbow", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "health", classItem: "A trophy from your first kill", spellItem: "", extraItems: "" },
    domainCardIds: ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"],
  });
  c.build.experiences[0].name = "Tracker";
  c.build.experiences[1].name = "Survivalist";
  return finishBuild(c, reg);
}

/** First Ranger-domain card at or below `max` level that the character doesn't have. */
const freeCard = (c: CharacterDoc, max: number, skip: string[] = []) =>
  reg.all("domain-card").find((x) => ["srd/domain/bone", "srd/domain/sage"].includes(x.domainId) && x.level <= max && !ownedCards(c).includes(x.id) && !skip.includes(x.id))!.id;

function lu(c: CharacterDoc, advancements: Advancement[], extra: Partial<LevelUp> = {}): LevelUp {
  const base = emptyLevelUp(c);
  if (base.newExperience) base.newExperience.name = `Lesson ${base.level}`;
  return { ...base, advancements, domainCardId: freeCard(c, base.level), ...extra };
}

/** Level up with the given picks; throws if invalid. */
const up = (c: CharacterDoc, advancements: Advancement[], extra: Partial<LevelUp> = {}) => applyLevelUp(c, lu(c, advancements, extra), reg);
/** Levels 2–4 with legal picks: HP+Stress, HP+Stress, Evasion+Experiences (uses up tier 2's HP and Stress). */
function toLevel4(c: CharacterDoc): CharacterDoc {
  c = up(c, [{ optionId: "hp" }, { optionId: "stress" }]);
  c = up(c, [{ optionId: "hp" }, { optionId: "stress" }]);
  return up(c, [{ optionId: "evasion" }, { optionId: "experiences", experienceIds: c.build.experiences.map((x) => x.id) }]);
}
const status = (c: CharacterDoc, picks: Advancement[] = []) => Object.fromEntries(optionStatus(c, reg, c.levelUps.length + 2, picks).map((o) => [o.id, o]));

describe("level-up limits (SRD pp. 53–54)", () => {
  it("tier 2 offers only the six basic options", () => {
    const s = status(rangerL1());
    expect(Object.entries(s).filter(([, o]) => o.available).map(([id]) => id).sort()).toEqual(["domain-card", "evasion", "experiences", "hp", "stress", "traits"]);
    expect(s.multiclass.reason).toMatch(/No unmarked slots|level 5/);
  });

  it("needs exactly two advancements, and a named Experience at level 2", () => {
    const c = rangerL1();
    expect(validateLevelUp(c, lu(c, [{ optionId: "hp" }]), reg)).toContain("Choose two advancements (1 of 2).");
    const bad = lu(c, [{ optionId: "hp" }, { optionId: "stress" }]);
    bad.newExperience!.name = "";
    expect(validateLevelUp(c, bad, reg)).toContain("Level 2 gives a new Experience at +2: name it.");
    expect(validateLevelUp(c, lu(c, [{ optionId: "hp" }, { optionId: "stress" }, { optionId: "evasion" }]), reg).some((e) => e.includes("already chosen two"))).toBe(true);
  });

  it("uses up tier slots (2 HP slots in tier 2) and reopens them in tier 3", () => {
    let c = rangerL1();
    c = up(c, [{ optionId: "hp" }, { optionId: "hp" }]); // level 2
    expect(status(c).hp.available).toBe(false);
    c = up(c, [{ optionId: "stress" }, { optionId: "evasion" }]); // 3
    c = up(c, [{ optionId: "stress" }, { optionId: "experiences", experienceIds: c.build.experiences.map((x) => x.id) }]); // 4
    expect(status(c).hp.available).toBe(true); // level 5 = tier 3 table
    expect(derive(c, reg).hpMax.total).toBe(6 + 2);
    expect(derive(c, reg).evasion.total).toBe(12 + 1);
  });

  it("can't raise a marked trait until marks clear at level 5", () => {
    let c = rangerL1();
    c = up(c, [{ optionId: "traits", traits: ["agility", "strength"] }, { optionId: "hp" }]); // level 2
    const again = lu(c, [{ optionId: "traits", traits: ["agility", "finesse"] }, { optionId: "hp" }]);
    expect(validateLevelUp(c, again, reg)).toContain("agility is already marked this tier.");
    c = up(c, [{ optionId: "traits", traits: ["finesse", "instinct"] }, { optionId: "stress" }]); // 3
    c = up(c, [{ optionId: "traits", traits: ["presence", "knowledge"] }, { optionId: "stress" }]); // 4: all six marked
    // level 5: tier achievement clears marks
    expect(status(c).traits.available).toBe(true);
    c = up(c, [{ optionId: "traits", traits: ["agility", "strength"] }, { optionId: "evasion" }]);
    expect(derive(c, reg).traits.agility.total).toBe(2 + 2);
    expect(derive(c, reg).proficiency.total).toBe(3); // achievements at 2 and 5
  });

  it("Proficiency and multiclass use both picks; multiclass needs level 5", () => {
    let c = rangerL1();
    for (const picks of [[{ optionId: "hp" }, { optionId: "stress" }], [{ optionId: "hp" }, { optionId: "stress" }], [{ optionId: "evasion" }, { optionId: "domain-card", cardId: "" }]] as Advancement[][]) {
      if (picks[1]?.optionId === "domain-card") picks[1].cardId = freeCard(c, c.levelUps.length + 2, [lu(c, []).domainCardId!]);
      c = up(c, picks);
    }
    expect(status(c, [{ optionId: "hp" }]).proficiency.available).toBe(false); // only one pick left
    const s = status(c);
    expect(s.proficiency.available).toBe(true);
    expect(s.multiclass.available).toBe(true);
  });

  it("multiclassing crosses out this tier's subclass upgrade and all later multiclassing", () => {
    let c = toLevel4(rangerL1());
    const mc: Advancement = { optionId: "multiclass", classId: "srd/class/wizard", domainId: "srd/domain/codex", subclassId: "srd/subclass/school-of-knowledge" };
    // level 5 card may come from the new domain at ≤ half level (3)
    const codex3 = reg.all("domain-card").find((x) => x.domainId === "srd/domain/codex" && x.level === 3)!;
    const codex4 = reg.all("domain-card").find((x) => x.domainId === "srd/domain/codex" && x.level === 4)!;
    expect(validateLevelUp(c, lu(c, [mc], { domainCardId: codex4.id }), reg).some((e) => e.includes("level 3 or lower"))).toBe(true);
    c = up(c, [mc], { domainCardId: codex3.id });
    const d = derive(c, reg);
    expect(d.domainIds).toContain("srd/domain/codex");
    expect(d.features.some((f) => f.source.startsWith("School of Knowledge"))).toBe(true);
    const s = status(c); // level 6, still tier 3
    expect(s.subclass.available).toBe(false);
    expect(s.multiclass.available).toBe(false);
  });

  it("a subclass upgrade crosses out multiclassing for that tier only", () => {
    let c = toLevel4(rangerL1());
    c = up(c, [{ optionId: "subclass", subclassId: c.build.subclassId! }, { optionId: "evasion" }]); // level 5
    expect(derive(c, reg).features.some((f) => f.source === "Wayfinder (specialization)")).toBe(true);
    expect(status(c).multiclass.available).toBe(false); // level 6, tier 3
    c = up(c, [{ optionId: "hp" }, { optionId: "stress" }]); // 6
    c = up(c, [{ optionId: "experiences", experienceIds: c.build.experiences.map((x) => x.id) }, { optionId: "stress" }]); // 7
    expect(status(c).multiclass.available).toBe(true); // level 8, tier 4
  });

  it("domain cards: at or below your level, from your domains, not already owned", () => {
    const c = rangerL1();
    const sage3 = reg.all("domain-card").find((x) => x.domainId === "srd/domain/sage" && x.level === 3)!;
    expect(validateLevelUp(c, lu(c, [{ optionId: "hp" }, { optionId: "stress" }], { domainCardId: sage3.id }), reg)).toContain(
      `New domain card: ${sage3.name} is level 3; you can take level 2 or lower from that domain.`,
    );
    expect(validateLevelUp(c, lu(c, [{ optionId: "hp" }, { optionId: "stress" }], { domainCardId: "srd/domain-card/rune-ward" }), reg)).toContain(
      "New domain card: Rune Ward isn't from one of your domains.",
    );
    expect(validateLevelUp(c, lu(c, [{ optionId: "hp" }, { optionId: "stress" }], { domainCardId: "srd/domain-card/gifted-tracker" }), reg)).toContain(
      "New domain card: you already have Gifted Tracker.",
    );
  });

  it("exchanges only for a card of the same level or lower", () => {
    const c = rangerL1();
    const sage2 = reg.all("domain-card").filter((x) => x.domainId === "srd/domain/sage" && x.level === 2);
    const bad = lu(c, [{ optionId: "hp" }, { optionId: "stress" }], { domainCardId: sage2[0].id, exchange: { fromId: "srd/domain-card/gifted-tracker", toId: sage2[1].id } });
    expect(validateLevelUp(c, bad, reg)).toContain("Exchange for a card of level 1 or lower.");
  });

  it("puts new cards in the loadout until it holds five, then the vault; undo reverses it", () => {
    let c = toLevel4(rangerL1());
    c = up(c, [{ optionId: "hp" }, { optionId: "stress" }]); // level 5: 2 starting + 4 new cards
    expect(c.state.loadout).toHaveLength(5);
    expect(c.state.vault).toHaveLength(1);
    const before = c.state.vault[0];
    c = undoLastLevelUp(c);
    expect(c.levelUps).toHaveLength(3);
    expect(c.state.vault).not.toContain(before);
  });

  it("blocks HP once it reaches 12", () => {
    const c = rangerL1();
    c.levelUps = Array.from({ length: 3 }, (_, i) => ({ level: i + 2, advancements: [{ optionId: "hp" }, { optionId: "hp" }], domainCardId: null, exchange: null }));
    // 6 + 6 = 12 (ledger aside, the cap check applies)
    expect(derive(c, reg).hpMax.total).toBe(12);
    expect(optionStatus(c, reg, 5).find((o) => o.id === "hp")?.reason).toMatch(/maximum of 12/);
  });
});

export type { EntryOf };
