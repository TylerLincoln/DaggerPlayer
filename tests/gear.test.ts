import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { finishBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { scriptedRng } from "../src/rules/dice.ts";
import { planDamage, rollGearDamage, takeDamage } from "../src/rules/duality.ts";
import { afterAttack, armorFeature, damageRules, onHit } from "../src/rules/gear.ts";
import { markArmorWithEffects, takeRest } from "../src/rules/sheet.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));

/** A finished level-1 Ranger wearing `armorId`, holding `weaponId`. */
function hero(armorId: string, weaponId = "srd/weapon/shortbow"): CharacterDoc {
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
  const done = finishBuild(c, reg);
  done.state.armorId = armorId;
  done.state.activePrimaryId = weaponId;
  return done;
}
const runes = () => hero("srd/armor/runes-of-fortification");

describe("armor that acts when you mark an Armor Slot", () => {
  it("Runes of Fortification (Painful): marking a slot on the tracker also marks a Stress", () => {
    const c = runes();
    const d = derive(c, reg);
    expect(armorFeature(c, reg)).toBe("Painful");
    const r = markArmorWithEffects(c, d, "Painful", 1);
    expect(r.doc.state.armorMarked).toBe(1);
    expect(r.doc.state.stressMarked).toBe(c.state.stressMarked + 1);
    expect(r.notes[0]).toMatch(/Painful armor: marked 1 Stress/);
    // tapping three slots at once marks three Stress
    expect(markArmorWithEffects(c, d, "Painful", 3).doc.state.stressMarked).toBe(c.state.stressMarked + 3);
  });

  it("Painful: using armor against damage marks the Stress too", () => {
    const c = runes();
    const d = derive(c, reg);
    const r = takeDamage(c, d, d.thresholds.major.total, { useArmor: true, armorFeature: armorFeature(c, reg) });
    expect(r.doc.state.armorMarked).toBe(1);
    expect(r.doc.state.stressMarked).toBe(c.state.stressMarked + 1);
    expect(r.notes.join(" ")).toMatch(/Painful armor/);
    // not marking armor: no Stress
    const plain = takeDamage(c, d, d.thresholds.major.total, { useArmor: false, armorFeature: "Painful" });
    expect(plain.doc.state.stressMarked).toBe(c.state.stressMarked);
  });

  it("Painful with every Stress marked marks a Hit Point instead (p. 50)", () => {
    const c = runes();
    const d = derive(c, reg);
    c.state.stressMarked = d.stressMax.total;
    const r = markArmorWithEffects(c, d, "Painful", 1);
    expect(r.doc.state.hpMarked).toBe(c.state.hpMarked + 1);
  });

  it("Divine: marking a slot gains a Hope", () => {
    const c = hero("srd/armor/godbound-laminar");
    c.state.hope = 2;
    const r = markArmorWithEffects(c, derive(c, reg), armorFeature(c, reg), 1);
    expect(r.doc.state.hope).toBe(3);
  });
});

describe("armor that acts on damage", () => {
  it("Bulky: Severe damage marks a Stress", () => {
    const c = hero("srd/armor/banded-armor");
    const d = derive(c, reg);
    const severe = takeDamage(c, d, d.thresholds.severe.total, { useArmor: false, armorFeature: "Bulky" });
    expect(severe.doc.state.stressMarked).toBe(c.state.stressMarked + 1);
    const major = takeDamage(c, d, d.thresholds.major.total, { useArmor: false, armorFeature: "Bulky" });
    expect(major.doc.state.stressMarked).toBe(c.state.stressMarked);
  });

  it("Fortified: an Armor Slot drops severity two thresholds", () => {
    const c = hero("srd/armor/full-fortified-armor");
    const d = derive(c, reg);
    const p = planDamage(d.thresholds.severe.total, d, c, { useArmor: true, armorFeature: "Fortified" });
    expect(p.hp).toBe(1); // Severe (3) → Minor (1)
  });

  it("Warded: magic damage is reduced by the Armor Score first; physical isn't", () => {
    const c = hero("srd/armor/elundrian-chain-armor");
    const d = derive(c, reg);
    const n = d.thresholds.major.total + 1;
    expect(planDamage(n, d, c, { useArmor: false, armorFeature: "Warded", damageType: "mag" }).final).toBe(n - d.armorScore.total);
    expect(planDamage(n, d, c, { useArmor: false, armorFeature: "Warded", damageType: "phy" }).final).toBe(n);
  });

  it("Physical and Magic armor refuse an Armor Slot against the other damage type", () => {
    const phys = hero("srd/armor/bladefare-armor");
    const dp = derive(phys, reg);
    expect(planDamage(dp.thresholds.major.total, dp, phys, { useArmor: true, armorFeature: "Physical", damageType: "mag" }).armorUsed).toBe(false);
    expect(planDamage(dp.thresholds.major.total, dp, phys, { useArmor: true, armorFeature: "Physical", damageType: "phy" }).armorUsed).toBe(true);
    const mag = hero("srd/armor/monetts-cloak");
    const dm = derive(mag, reg);
    expect(planDamage(dm.thresholds.major.total, dm, mag, { useArmor: true, armorFeature: "Magic", damageType: "phy" }).armorUsed).toBe(false);
  });
});

describe("armor bonuses the modifier parser can't express", () => {
  it("Reinforced: +2 thresholds while the last Armor Slot is marked", () => {
    const c = hero("srd/armor/irontree-breastplate-armor");
    const before = derive(c, reg);
    c.state.armorMarked = before.armorScore.total;
    const after = derive(c, reg);
    expect(after.thresholds.major.total).toBe(before.thresholds.major.total + 2);
    expect(after.thresholds.severe.total).toBe(before.thresholds.severe.total + 2);
  });

  it("Magnificent: Armor Score + Presence; Difficult: −1 to every trait and Evasion", () => {
    const fin = hero("srd/armor/granminsters-finery");
    const df = derive(fin, reg);
    expect(df.armorScore.total).toBe(2 + df.traits.presence.total);
    const plain = derive(hero("srd/armor/leather-armor"), reg);
    const diff = derive(hero("srd/armor/savior-chainmail"), reg);
    expect(diff.traits.agility.total).toBe(plain.traits.agility.total - 1);
    expect(diff.traits.knowledge.total).toBe(plain.traits.knowledge.total - 1);
    expect(diff.evasion.parts.some((p) => /Difficult/.test(p.source))).toBe(true);
  });

  it("Attuned: thresholds + tier and a loadout of 4", () => {
    const c = hero("srd/armor/rune-forged-exosuit");
    const d = derive(c, reg);
    expect(d.loadoutMax).toBe(4);
    expect(d.thresholds.major.parts.some((p) => /Attuned/.test(p.source) && p.value === d.tier)).toBe(true);
    expect(derive(runes(), reg).loadoutMax).toBe(5);
  });

  it("Enchanted: thresholds + the Spellcast trait (Wayfinder: Agility)", () => {
    const d = derive(hero("srd/armor/mage-robes"), reg);
    expect(d.thresholds.major.parts.find((p) => /Enchanted/.test(p.source))?.value).toBe(d.traits.agility.total);
  });

  it("Self-Healing: a rest clears an Armor Slot", () => {
    const c = hero("srd/armor/trollhide-cuirass");
    c.state.armorMarked = 2;
    const r = takeRest(c, reg, "short", ["prepare"]);
    expect(r.doc.state.armorMarked).toBe(1);
    expect(r.notes.join(" ")).toMatch(/Self-Healing/);
  });
});

describe("weapons", () => {
  const roller = (...faces: number[]) => { let i = 0; return () => faces[i++ % faces.length]; };
  const ctx = (c: CharacterDoc) => { const d = derive(c, reg); return { level: d.level, agility: d.traits.agility.total }; };

  it("Painful weapon (Bloodstaff): a successful attack marks a Stress", () => {
    const c = hero("srd/armor/leather-armor", "srd/weapon/bloodstaff");
    const h = onHit(reg.get("srd/weapon/bloodstaff", "weapon"), c, reg, false, roller(1));
    expect(h.stress).toBe(1);
  });

  it("Invigorating on a 4 clears a Stress; Lifestealing on a 6 asks", () => {
    const c = hero("srd/armor/leather-armor");
    expect(onHit(reg.get("srd/weapon/enchanted-lute", "weapon"), c, reg, false, roller(4)).clearStress).toBe(1);
    expect(onHit(reg.get("srd/weapon/enchanted-lute", "weapon"), c, reg, false, roller(3)).clearStress).toBe(0);
    // Lifestealing asks the player which to clear, and clears nothing by itself
    const six = onHit(reg.get("srd/weapon/siphoning-gauntlets", "weapon"), c, reg, false, roller(6));
    expect(six.ask).toBe("hp-or-stress");
    expect(six.clearHp + six.clearStress).toBe(0);
    expect(onHit(reg.get("srd/weapon/siphoning-gauntlets", "weapon"), c, reg, false, roller(5)).ask).toBeNull();
  });

  it("Bloodthirsty armor: a critical Melee weapon hit clears a Hit Point", () => {
    const c = hero("srd/armor/bloodstone-plate-armor", "srd/weapon/curved-dagger");
    expect(onHit(reg.get("srd/weapon/curved-dagger", "weapon"), c, reg, true, roller(1)).clearHp).toBe(1);
    expect(onHit(reg.get("srd/weapon/curved-dagger", "weapon"), c, reg, false, roller(1)).clearHp).toBe(0);
  });

  it("Reloading rolls a d6 after each attack", () => {
    const w = reg.get("srd/weapon/runelock-pistol", "weapon");
    expect(afterAttack(w, roller(1))[0]).toMatch(/mark a Stress to reload/);
    expect(afterAttack(w, roller(4))[0]).toMatch(/no reload/);
    expect(afterAttack(reg.get("srd/weapon/shortbow", "weapon"), roller(1))).toEqual([]);
  });

  it("damage dice: Powerful drops the lowest of an extra die, Serrated turns 1s into 8s, Sharpwing adds Agility", () => {
    const c = hero("srd/armor/leather-armor", "srd/weapon/greatstaff");
    const powerful = rollGearDamage([{ count: 1, die: 6 }], 0, false, damageRules(reg.get("srd/weapon/greatstaff", "weapon"), c, reg, ctx(c)), scriptedRng([{ value: 2, sides: 6 }, { value: 5, sides: 6 }]));
    expect(powerful.total).toBe(5);
    const serrated = rollGearDamage([{ count: 2, die: 8 }], 9, false, damageRules(reg.get("srd/weapon/curved-dagger", "weapon"), c, reg, ctx(c)), scriptedRng([{ value: 1, sides: 8 }, { value: 3, sides: 8 }]));
    expect(serrated.total).toBe(8 + 3 + 9);
    const sharp = rollGearDamage([{ count: 1, die: 8 }], 5, false, damageRules(reg.get("srd/weapon/flickerfly-blade", "weapon"), c, reg, ctx(c)), scriptedRng([{ value: 4, sides: 8 }]));
    expect(sharp.total).toBe(4 + 5 + ctx(c).agility);
  });

  it("Sharp armor adds a d4 to Melee weapon damage only", () => {
    const c = hero("srd/armor/spiked-plate-armor");
    expect(damageRules(reg.get("srd/weapon/curved-dagger", "weapon"), c, reg, ctx(c)).extraDice).toHaveLength(1);
    expect(damageRules(reg.get("srd/weapon/shortbow", "weapon"), c, reg, ctx(c)).extraDice).toHaveLength(0);
  });
});
