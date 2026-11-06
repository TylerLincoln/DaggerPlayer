import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { canFinish, finishBuild, validateBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { derive, diffDerived, formatChange } from "../src/rules/derive.ts";
import { assignTrait, emptyTraitsFor, isValidSpread, remainingValues } from "./helpers.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));

/** A complete, valid level-1 Ranger (Wayfinder), Human, Highborne. */
function ranger(over: (c: CharacterDoc) => void = () => {}): CharacterDoc {
  const c = newCharacter();
  c.identity.name = "Wren";
  c.build.classId = "srd/class/ranger";
  c.build.subclassId = "srd/subclass/wayfinder";
  c.build.ancestry = { kind: "single", id: "srd/ancestry/human" };
  c.build.communityId = "srd/community/highborne";
  c.build.traits = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 };
  c.build.gear = { primaryId: "srd/weapon/shortbow", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "health", classItem: "A trophy from your first kill", spellItem: "", extraItems: "" };
  c.build.experiences[0].name = "Tracker";
  c.build.experiences[1].name = "Survivalist";
  c.build.domainCardIds = ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"];
  over(c);
  return c;
}

describe("trait assignment (SRD p. 4)", () => {
  it("tracks the remaining values and validates the spread", () => {
    let t = emptyTraitsFor();
    expect(remainingValues(t)).toEqual([2, 1, 1, 0, 0, -1]);
    t = assignTrait(t, "agility", 2);
    t = assignTrait(t, "strength", 1);
    expect(remainingValues(t)).toEqual([1, 0, 0, -1]);
    expect(isValidSpread(t)).toBe(false);
    for (const [k, v] of [["finesse", 1], ["instinct", 0], ["presence", 0], ["knowledge", -1]] as const) t = assignTrait(t, k, v);
    expect(isValidSpread(t)).toBe(true);
  });

  it("swaps when a taken value is assigned again, so the spread stays legal", () => {
    let t = emptyTraitsFor();
    t = assignTrait(t, "agility", 2);
    t = assignTrait(t, "strength", -1);
    t = assignTrait(t, "strength", 2); // +2 moves from agility; agility gets strength's −1
    expect(t.strength).toBe(2);
    expect(t.agility).toBe(-1);
    expect(() => assignTrait(t, "finesse", 3)).toThrow();
  });
});

describe("derived stats", () => {
  it("level 1 Ranger in leather armor", () => {
    const d = derive(ranger(), reg);
    expect(d.level).toBe(1);
    expect(d.evasion.total).toBe(12); // Ranger starting Evasion
    expect(d.hpMax.total).toBe(6); // Ranger starting HP
    expect(d.stressMax.total).toBe(7); // 6 + Human High Stamina
    expect(d.proficiency.total).toBe(1);
    expect(d.armorScore.total).toBe(3); // Leather Armor base score
    expect(d.thresholds.major.total).toBe(7); // 6 + level 1
    expect(d.thresholds.severe.total).toBe(14); // 13 + level 1
    expect(d.traits.agility.total).toBe(2);
  });

  it("unarmored thresholds are level and 2 × level (p. 72)", () => {
    const d = derive(ranger((c) => (c.build.gear.armorId = null)), reg);
    expect(d.armorScore.total).toBe(0);
    expect(d.thresholds.major.total).toBe(1);
    expect(d.thresholds.severe.total).toBe(2);
  });

  it("applies ancestry, subclass and equipment modifiers", () => {
    const d = derive(
      ranger((c) => {
        c.build.ancestry = { kind: "single", id: "srd/ancestry/simiah" }; // Nimble +1 Evasion
        c.build.gear.armorId = "srd/armor/full-plate-armor"; // Very Heavy: −2 Evasion, −1 Agility
      }),
      reg,
    );
    expect(d.evasion.total).toBe(12 + 1 - 2);
    expect(d.traits.agility.total).toBe(1);
    expect(d.evasion.parts.map((p) => p.source)).toContain("Simiah: Nimble");
  });

  it("mixed ancestry takes the top feature of one and the bottom of the other", () => {
    const humanTop = derive(ranger((c) => (c.build.ancestry = { kind: "mixed", topFrom: "srd/ancestry/human", bottomFrom: "srd/ancestry/simiah", label: "" })), reg);
    expect(humanTop.stressMax.total).toBe(7); // High Stamina (Human top)
    expect(humanTop.evasion.total).toBe(13); // Nimble (Simiah bottom)
    const simiahTop = derive(ranger((c) => (c.build.ancestry = { kind: "mixed", topFrom: "srd/ancestry/simiah", bottomFrom: "srd/ancestry/human", label: "" })), reg);
    expect(simiahTop.stressMax.total).toBe(6); // Natural Climber + Adaptability: no stat changes
    expect(simiahTop.evasion.total).toBe(12);
  });

  it("Earthkin and Stalwart add to Armor Score and both thresholds", () => {
    const d = derive(
      ranger((c) => {
        c.build.classId = "srd/class/guardian";
        c.build.subclassId = "srd/subclass/stalwart"; // Unwavering +1 thresholds
        c.build.ancestry = { kind: "single", id: "srd/ancestry/earthkin" }; // Stoneskin +1 Armor Score and thresholds
      }),
      reg,
    );
    expect(d.armorScore.total).toBe(3 + 1);
    expect(d.thresholds.major.total).toBe(6 + 1 + 1 + 1);
    expect(d.thresholds.severe.total).toBe(13 + 1 + 1 + 1);
  });

  it("armor-only card bonuses need armor", () => {
    const withCard = (armorId: string | null) =>
      derive(ranger((c) => { c.build.gear.armorId = armorId; c.build.domainCardIds = ["srd/domain-card/armorer", "srd/domain-card/gifted-tracker"]; }), reg);
    expect(withCard("srd/armor/leather-armor").armorScore.total).toBe(3 + 1);
    expect(withCard(null).armorScore.total).toBe(0);
  });

  it("caps HP at 12", () => {
    const c = ranger();
    c.levelUps = Array.from({ length: 9 }, (_, i) => ({ level: i + 2, advancements: [{ optionId: "hp" }, { optionId: "hp" }], domainCardId: null, exchange: null }));
    const d = derive(c, reg);
    expect(d.hpMax.total).toBe(12);
    expect(d.hpMax.capped).toBe(true);
    expect(d.level).toBe(10);
    expect(d.proficiency.total).toBe(4); // tier achievements at 2, 5 and 8
    expect(d.thresholds.major.total).toBe(6 + 10);
  });

  it("explains choices as stat changes", () => {
    const before = derive(ranger(), reg);
    const after = derive(ranger((c) => (c.build.ancestry = { kind: "single", id: "srd/ancestry/simiah" })), reg);
    expect(diffDerived(before, after).map(formatChange)).toEqual(["+1 Evasion", "−1 Stress"]);
  });
});

describe("builder validation (SRD pp. 4–6)", () => {
  const errors = (c: CharacterDoc) => validateBuild(c, reg).filter((i) => i.severity === "error").map((i) => i.message);

  it("accepts a complete build", () => {
    expect(errors(ranger())).toEqual([]);
    expect(canFinish(validateBuild(ranger(), reg))).toBe(true);
  });

  it("lists everything missing on an empty character", () => {
    const issues = validateBuild(newCharacter(), reg);
    expect(new Set(issues.filter((i) => i.severity === "error").map((i) => i.step))).toEqual(new Set(["class", "heritage", "traits", "gear", "background", "cards"]));
  });

  it("rejects a secondary weapon with a two-handed primary", () => {
    expect(errors(ranger((c) => { c.build.gear.primaryId = "srd/weapon/longbow"; c.build.gear.secondaryId = "srd/weapon/small-dagger"; }))).toContain(
      "Longbow is two-handed, so you can't also carry a secondary weapon.",
    );
  });

  it("allows a one-handed primary with a one-handed secondary", () => {
    expect(errors(ranger((c) => { c.build.gear.primaryId = "srd/weapon/broadsword"; c.build.gear.secondaryId = "srd/weapon/small-dagger"; }))).toEqual([]);
  });

  it("requires a Spellcast trait for magic weapons", () => {
    const guardian = (c: CharacterDoc) => { c.build.classId = "srd/class/guardian"; c.build.subclassId = "srd/subclass/stalwart"; c.build.domainCardIds = ["srd/domain-card/get-back-up", "srd/domain-card/whirlwind"]; };
    expect(errors(ranger((c) => { guardian(c); c.build.gear.primaryId = "srd/weapon/arcane-gauntlets"; })).some((m) => m.includes("Spellcast trait"))).toBe(true);
    expect(errors(ranger((c) => (c.build.gear.primaryId = "srd/weapon/arcane-gauntlets")))).toEqual([]); // Wayfinder has Agility
  });

  it("rejects higher-tier gear", () => {
    expect(errors(ranger((c) => (c.build.gear.armorId = "srd/armor/improved-leather-armor")))).toContain("Improved Leather Armor is Tier 2; start with Tier 1 armor.");
  });

  it("checks domain cards: two, level 1, from the class's domains", () => {
    expect(errors(ranger((c) => (c.build.domainCardIds = ["srd/domain-card/gifted-tracker"])))).toContain("Choose two level 1 domain cards (1 of 2).");
    expect(errors(ranger((c) => (c.build.domainCardIds = ["srd/domain-card/gifted-tracker", "srd/domain-card/rune-ward"])))).toContain("Rune Ward isn't from one of your class's domains.");
    const lvl2 = reg.all("domain-card").find((x) => x.domainId === "srd/domain/sage" && x.level === 2)!;
    expect(errors(ranger((c) => (c.build.domainCardIds = ["srd/domain-card/gifted-tracker", lvl2.id])))).toContain(`${lvl2.name} is level 2; starting cards are level 1.`);
  });

  it("rejects a mixed ancestry from a single ancestry, and invalid traits", () => {
    expect(errors(ranger((c) => (c.build.ancestry = { kind: "mixed", topFrom: "srd/ancestry/elf", bottomFrom: "srd/ancestry/elf", label: "" }))).length).toBe(1);
    expect(errors(ranger((c) => (c.build.traits.knowledge = 2)))).toContain("Traits must use +2, +1, +1, +0, +0 and −1 exactly once each.");
  });

  it("asks Clank characters to choose their purposeful Experience", () => {
    const clank = ranger((c) => (c.build.ancestry = { kind: "single", id: "srd/ancestry/clank" }));
    expect(errors(clank).some((m) => m.startsWith("Purposeful Design:"))).toBe(true);
    clank.build.featureChoices["clank-purpose"] = clank.build.experiences[0].id;
    expect(errors(clank)).toEqual([]);
    expect(derive(clank, reg).experiences[0].bonus.total).toBe(3);
  });
});

describe("starting sheet (SRD pp. 4–5)", () => {
  it("equips gear, sets Hope, gold, loadout and inventory", () => {
    const c = finishBuild(ranger(), reg, new Date("2026-11-06T00:00:00Z"));
    expect(c.finishedAt).toBe("2026-11-06T00:00:00.000Z");
    expect(c.state.hope).toBe(2);
    expect(c.state.gold).toEqual({ handfuls: 1, bags: 0, chests: 0 });
    expect(c.state.loadout).toEqual(c.build.domainCardIds);
    expect(c.state.activePrimaryId).toBe("srd/weapon/shortbow");
    expect(c.state.inventory.map((i) => i.name)).toEqual(["Torch", "50 feet of rope", "Basic supplies", "Minor Health Potion", "A trophy from your first kill"]);
    expect(c.state.inventory[3].entryId).toBe("srd/consumable/minor-health-potion");
    expect(derive(c, reg).armorScore.total).toBe(3); // equipped from state after finishing
  });

  it("refuses to finish an incomplete build", () => {
    expect(() => finishBuild(newCharacter(), reg)).toThrow(/incomplete/);
  });
});
