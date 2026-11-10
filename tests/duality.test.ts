import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { finishBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { scriptedRng } from "../src/rules/dice.ts";
import { applyDuality, describeDuality, planDamage, rollDamage, rollDuality, severityOf, spendForExperiences, takeDamage } from "../src/rules/duality.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const d12 = (v: number) => ({ value: v, sides: 12 });
const d6 = (v: number) => ({ value: v, sides: 6 });

function wren(): CharacterDoc {
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
  return finishBuild(c, reg); // leather armor: thresholds 7/14, Armor Score 3
}

describe("duality dice (p. 47)", () => {
  const agi = [{ label: "Agility", value: 2 }];

  it("higher die decides Hope or Fear; total includes modifiers", () => {
    const r = rollDuality({ modifiers: agi, advantage: 0, disadvantage: 0, difficulty: 12 }, scriptedRng([d12(9), d12(4)]));
    expect([r.hope, r.fear, r.total, r.kind, r.success]).toEqual([9, 4, 15, "hope", true]);
    expect(describeDuality(r)).toBe("Success with Hope");
    const f = rollDuality({ modifiers: agi, advantage: 0, disadvantage: 0, difficulty: 15 }, scriptedRng([d12(3), d12(8)]));
    expect(describeDuality(f)).toBe("Failure with Fear");
  });

  it("matching dice are a Critical Success, even below the Difficulty", () => {
    const r = rollDuality({ modifiers: [], advantage: 0, disadvantage: 0, difficulty: 20 }, scriptedRng([d12(2), d12(2)]));
    expect(r.kind).toBe("crit");
    expect(r.success).toBe(true);
    expect(describeDuality(r)).toBe("Critical Success!");
  });

  it("announces '[total] with [Hope/Fear]' when the Difficulty isn't shared", () => {
    const r = rollDuality({ modifiers: [{ label: "Agility", value: 1 }], advantage: 0, disadvantage: 0 }, scriptedRng([d12(5), d12(7)]));
    expect(describeDuality(r)).toBe("13 with Fear"); // the SRD's own example
  });

  it("advantage and disadvantage cancel one for one; never more than one die (p. 49)", () => {
    const three = rollDuality({ modifiers: [], advantage: 3, disadvantage: 1 }, scriptedRng([d12(5), d12(6), d6(4)]));
    expect(three.extraDie).toEqual({ kind: "advantage", value: 4, from: "you" });
    expect(three.total).toBe(15);
    const cancel = rollDuality({ modifiers: [], advantage: 1, disadvantage: 1 }, scriptedRng([d12(5), d12(6)]));
    expect(cancel.extraDie).toBeNull();
    const dis = rollDuality({ modifiers: [], advantage: 0, disadvantage: 2 }, scriptedRng([d12(5), d12(6), d6(3)]));
    expect(dis.total).toBe(8);
  });

  it("Help an Ally: only the highest advantage die counts (the SRD's Anne example)", () => {
    // Anne: +1 Agility, 13 with Hope on the Duality Dice, rolls 2 on her advantage die; Bo and Cameron roll 3 and 4
    const r = rollDuality({ modifiers: [{ label: "Agility", value: 1 }], advantage: 1, disadvantage: 0, helpDice: [3, 4] }, scriptedRng([d12(7), d12(6), d6(2)]));
    expect(r.total).toBe(18);
    expect(r.kind).toBe("hope");
    expect(r.extraDie).toEqual({ kind: "advantage", value: 4, from: "ally" });
  });
});

describe("applying results", () => {
  it("with Hope gains a Hope; a crit also clears a Stress; Fear changes nothing on the sheet", () => {
    const c = wren();
    c.state.stressMarked = 2;
    const d = derive(c, reg);
    const hope = rollDuality({ modifiers: [], advantage: 0, disadvantage: 0 }, scriptedRng([d12(8), d12(3)]));
    expect(applyDuality(c, d, hope).doc.state.hope).toBe(3);
    const crit = rollDuality({ modifiers: [], advantage: 0, disadvantage: 0 }, scriptedRng([d12(6), d12(6)]));
    const after = applyDuality(c, d, crit).doc;
    expect([after.state.hope, after.state.stressMarked]).toEqual([3, 1]);
    const fear = rollDuality({ modifiers: [], advantage: 0, disadvantage: 0 }, scriptedRng([d12(2), d12(9)]));
    expect(applyDuality(c, d, fear)).toEqual({ doc: c, notes: ["The GM gains a Fear."] });
  });

  it("reaction rolls generate no Hope or Fear, even on a crit (p. 48)", () => {
    const c = wren();
    c.state.stressMarked = 2;
    const crit = rollDuality({ modifiers: [], advantage: 0, disadvantage: 0, reaction: true }, scriptedRng([d12(6), d12(6)]));
    expect(applyDuality(c, derive(c, reg), crit).doc).toBe(c);
  });

  it("each Experience costs a Hope", () => {
    const c = wren(); // 2 Hope
    expect(spendForExperiences(c, 2).state.hope).toBe(0);
    expect(() => spendForExperiences(c, 3)).toThrow(/costs 3 Hope/);
  });
});

describe("damage rolls (p. 50)", () => {
  it("Proficiency sets the dice; the modifier isn't multiplied; crits add the dice maximum", () => {
    const r = rollDamage(2, 8, 2, false, scriptedRng([{ value: 3, sides: 8 }, { value: 5, sides: 8 }]));
    expect([r.total, r.formula]).toEqual([10, "2d8+2"]);
    const crit = rollDamage(2, 8, 1, true, scriptedRng([{ value: 3, sides: 8 }, { value: 5, sides: 8 }]));
    expect([crit.total, crit.formula]).toEqual([3 + 5 + 1 + 16, "2d8+1+16"]); // the SRD's 2d8+1+16 example
  });
});

describe("taking damage (p. 50)", () => {
  it("compares to thresholds: Minor 1, Major 2, Severe 3, none at 0", () => {
    expect([0, 1, 6, 7, 13, 14, 40].map((n) => severityOf(n, 7, 14))).toEqual([0, 1, 1, 2, 2, 3, 3]);
    expect(severityOf(28, 7, 14, true)).toBe(4); // optional Massive Damage
    expect(severityOf(27, 7, 14, true)).toBe(3);
  });

  it("an Armor Slot drops the severity one step; direct damage ignores armor", () => {
    const c = wren();
    const d = derive(c, reg);
    const r = takeDamage(c, d, 15, { useArmor: true });
    expect(r.plan.severity).toBe(2);
    expect([r.doc.state.hpMarked, r.doc.state.armorMarked]).toEqual([2, 1]);
    const direct = takeDamage(c, d, 15, { useArmor: true, direct: true });
    expect([direct.doc.state.hpMarked, direct.doc.state.armorMarked]).toEqual([3, 0]);
    const minor = takeDamage(c, d, 3, { useArmor: true });
    expect(minor.doc.state.hpMarked).toBe(0); // Minor → none
  });

  it("resistance halves first (rounding up), immunity ignores it", () => {
    const c = wren();
    const d = derive(c, reg);
    expect(planDamage(15, d, c, { useArmor: false, resistant: true }).final).toBe(8); // 7.5 → 8: Major
    expect(planDamage(15, d, c, { useArmor: false, resistant: true }).hp).toBe(2);
    expect(planDamage(15, d, c, { useArmor: true, immune: true }).hp).toBe(0);
  });

  it("can't mark armor that's all used, or when unarmored", () => {
    const c = wren();
    c.state.armorMarked = 3;
    expect(planDamage(15, derive(c, reg), c, { useArmor: true }).armorUsed).toBe(false);
  });
});
