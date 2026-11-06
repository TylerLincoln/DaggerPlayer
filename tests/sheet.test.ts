import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { finishBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { roll, scriptedRng } from "../src/rules/dice.ts";
import { addGold, clearStress, fromVault, gainHope, markArmor, markStress, mustLongRest, RuleError, setItemQty, spendHope, stressVulnerable, swapWeapon, takeRest, toVault } from "../src/rules/sheet.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));

function wren(): CharacterDoc {
  const c = newCharacter();
  c.identity.name = "Wren";
  Object.assign(c.build, {
    classId: "srd/class/ranger", subclassId: "srd/subclass/wayfinder", ancestry: { kind: "single", id: "srd/ancestry/elf" }, communityId: "srd/community/highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    gear: { primaryId: "srd/weapon/broadsword", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "stamina", classItem: "A trophy from your first kill", spellItem: "", extraItems: "" },
    domainCardIds: ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"],
  });
  c.build.experiences[0].name = "Tracker";
  c.build.experiences[1].name = "Survivalist";
  return finishBuild(c, reg);
}
const d = (c: CharacterDoc) => derive(c, reg);

describe("Stress (p. 50)", () => {
  it("marks Stress; the last one makes you Vulnerable; overflow marks 1 HP", () => {
    let c = wren();
    const max = d(c).stressMax.total; // 6
    let r = markStress(c, d(c), max - 1);
    expect(r.doc.state.stressMarked).toBe(5);
    expect(stressVulnerable(r.doc, d(r.doc))).toBe(false);
    r = markStress(r.doc, d(r.doc), 1);
    expect(r.notes.join()).toMatch(/Vulnerable/);
    expect(stressVulnerable(r.doc, d(r.doc))).toBe(true);
    r = markStress(r.doc, d(r.doc), 2);
    expect(r.doc.state.stressMarked).toBe(6);
    expect(r.doc.state.hpMarked).toBe(1); // 1 HP, not 2
    c = clearStress(r.doc, 1);
    expect(stressVulnerable(c, d(c))).toBe(false);
  });

  it("asks for a death move on the last Hit Point", () => {
    const c = wren();
    c.state.hpMarked = d(c).hpMax.total - 1;
    c.state.stressMarked = d(c).stressMax.total;
    expect(markStress(c, d(c), 1).notes.join()).toMatch(/death move/);
  });
});

describe("Hope and Armor Slots", () => {
  it("caps Hope at 6 minus scars and refuses to overspend", () => {
    let c = wren();
    c = gainHope(c, d(c), 10);
    expect(c.state.hope).toBe(6);
    c.state.scars = 1;
    c = gainHope(c, d(c), 1);
    expect(c.state.hope).toBe(5);
    expect(() => spendHope(c, 6)).toThrow(RuleError);
  });

  it("limits Armor Slots to the Armor Score, and none when unarmored (p. 72)", () => {
    let c = wren(); // leather armor: score 3
    c = markArmor(c, d(c), 3);
    expect(() => markArmor(c, d(c), 1)).toThrow(/No unmarked/);
    c.state.armorId = null;
    c.state.armorMarked = 0;
    expect(() => markArmor(c, d(c), 1)).toThrow(/Armor Score of 0/);
  });
});

describe("loadout and vault (p. 8)", () => {
  it("vaulting is free; recalling costs the Recall Cost in Stress unless resting", () => {
    let c = wren();
    c = toVault(c, "srd/domain-card/vicious-entangle"); // recall cost 1
    const resting = fromVault(c, reg, "srd/domain-card/vicious-entangle", { resting: true });
    expect(resting.doc.state.stressMarked).toBe(0);
    const inDanger = fromVault(c, reg, "srd/domain-card/vicious-entangle", { resting: false });
    expect(inDanger.doc.state.stressMarked).toBe(reg.get("srd/domain-card/vicious-entangle", "domain-card")!.recallCost);
    expect(inDanger.doc.state.loadout).toContain("srd/domain-card/vicious-entangle");
  });

  it("needs a card to swap out when the loadout is full, and can't recall with all Stress marked", () => {
    const c = wren();
    c.state.loadout = ["a", "b", "c", "d", "e"];
    c.state.vault = ["srd/domain-card/vicious-entangle"];
    expect(() => fromVault(c, reg, "srd/domain-card/vicious-entangle", { resting: true })).toThrow(/choose one/);
    const r = fromVault(c, reg, "srd/domain-card/vicious-entangle", { resting: true, swapOutId: "a" });
    expect(r.doc.state.loadout).toHaveLength(5);
    expect(r.doc.state.vault).toEqual(["a"]);
    const full = structuredClone(c);
    full.state.stressMarked = d(full).stressMax.total;
    expect(() => fromVault(full, reg, "srd/domain-card/vicious-entangle", { resting: false, swapOutId: "a" })).toThrow(/can't pay/);
  });
});

describe("weapons (p. 55)", () => {
  it("swapping is free in calm, 1 Stress otherwise; two-handed primaries push the secondary out", () => {
    let c = wren();
    c.state.activeSecondaryId = "srd/weapon/small-dagger";
    c.state.inventoryWeaponIds = ["srd/weapon/longbow"];
    const r = swapWeapon(c, reg, "srd/weapon/longbow", false);
    expect(r.doc.state.activePrimaryId).toBe("srd/weapon/longbow");
    expect(r.doc.state.activeSecondaryId).toBeNull();
    expect(r.doc.state.inventoryWeaponIds.sort()).toEqual(["srd/weapon/broadsword", "srd/weapon/small-dagger"]);
    expect(r.doc.state.stressMarked).toBe(1);
    c = swapWeapon(c, reg, "srd/weapon/longbow", true).doc;
    expect(c.state.stressMarked).toBe(0);
  });

  it("refuses weapons above your tier", () => {
    const c = wren();
    c.state.inventoryWeaponIds = ["srd/weapon/improved-broadsword"];
    expect(() => swapWeapon(c, reg, "srd/weapon/improved-broadsword", true)).toThrow(/Tier 2/);
  });
});

describe("gold (p. 84) and consumables (p. 80)", () => {
  it("rolls 10 handfuls into a bag and 10 bags into a chest; max 1 chest", () => {
    expect(addGold({ handfuls: 9, bags: 0, chests: 0 }, "handfuls", 1)).toEqual({ handfuls: 0, bags: 1, chests: 0 });
    expect(addGold({ handfuls: 0, bags: 9, chests: 0 }, "bags", 1)).toEqual({ handfuls: 0, bags: 0, chests: 1 });
    expect(addGold({ handfuls: 3, bags: 2, chests: 0 }, "handfuls", -5)).toEqual({ handfuls: 8, bags: 1, chests: 0 });
    expect(() => addGold({ handfuls: 0, bags: 0, chests: 1 }, "chests", 1)).toThrow(/1 chest/);
    expect(() => addGold({ handfuls: 1, bags: 0, chests: 0 }, "bags", -1)).toThrow(/don't have/);
  });

  it("caps each consumable at 5", () => {
    const c = wren();
    const potion = c.state.inventory.find((i) => i.entryId === "srd/consumable/minor-stamina-potion")!;
    expect(setItemQty(c, reg, potion.id, 5).state.inventory.find((i) => i.id === potion.id)!.qty).toBe(5);
    expect(() => setItemQty(c, reg, potion.id, 6)).toThrow(/up to 5/);
    const torch = c.state.inventory.find((i) => i.name === "Torch")!;
    expect(setItemQty(c, reg, torch.id, 9).state.inventory.find((i) => i.id === torch.id)!.qty).toBe(9);
  });
});

describe("rests (p. 52)", () => {
  it("short rest moves clear 1d4 + tier; the same move can be taken twice", () => {
    const c = wren();
    c.state.hpMarked = 5;
    c.state.stressMarked = 4;
    const r = takeRest(c, reg, "short", ["tend", "stress"], scriptedRng([{ value: 3, sides: 4 }, { value: 1, sides: 4 }]));
    expect(r.doc.state.hpMarked).toBe(5 - (3 + 1)); // tier 1
    expect(r.doc.state.stressMarked).toBe(4 - (1 + 1));
    expect(takeRest(c, reg, "short", ["prepare", "prepare"]).doc.state.hope).toBe(4);
  });

  it("long rest moves clear everything; three short rests force a long one", () => {
    let c = wren();
    c.state.hpMarked = 5;
    c.state.armorMarked = 2;
    const r = takeRest(c, reg, "long", ["tend", "armor"]);
    expect(r.doc.state.hpMarked).toBe(0);
    expect(r.doc.state.armorMarked).toBe(0);
    for (let i = 0; i < 3; i++) c = takeRest(c, reg, "short", []).doc;
    expect(mustLongRest(c)).toBe(true);
    expect(() => takeRest(c, reg, "short", [])).toThrow(/long rest/);
    c = takeRest(c, reg, "long", []).doc;
    expect(mustLongRest(c)).toBe(false);
  });

  it("expires effects that last until the next rest", () => {
    const c = wren();
    c.state.effects = [
      { id: "1", label: "Rogue's Dodge", on: true, until: "rest" },
      { id: "2", label: "Blessing", on: true, until: "long-rest" },
      { id: "3", label: "Cursed", on: true, until: null },
    ];
    expect(takeRest(c, reg, "short", []).doc.state.effects.map((e) => e.label)).toEqual(["Blessing", "Cursed"]);
    expect(takeRest(c, reg, "long", []).doc.state.effects.map((e) => e.label)).toEqual(["Cursed"]);
  });

  it("rejects more than two moves", () => {
    expect(() => takeRest(wren(), reg, "short", ["tend", "tend", "tend"])).toThrow(/up to two/);
  });
});

describe("dice", () => {
  it("rolls expressions", () => {
    const r = roll("2d6+3", scriptedRng([{ value: 6, sides: 6 }, { value: 2, sides: 6 }]));
    expect(r.total).toBe(11);
    expect(() => roll("banana")).toThrow();
    for (let i = 0; i < 200; i++) {
      const v = roll("1d12").total;
      expect(v).toBeGreaterThanOrEqual(1);
      expect(v).toBeLessThanOrEqual(12);
    }
  });
});
