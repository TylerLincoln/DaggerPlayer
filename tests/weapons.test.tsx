import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { ContentContext } from "../src/content/ContentProvider.tsx";
import { Registry } from "../src/content/registry.ts";
import { SearchIndex } from "../src/content/search.ts";
import { createLocal } from "../src/data/characters.ts";
import { SheetPage } from "../src/features/sheet/SheetPage.tsx";
import { finishBuild, validateBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { equipWeapon, transform, unequipWeapon } from "../src/rules/sheet.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));

function hero(classId: string, subclassId: string, primaryId: string, secondaryId: string | null = null): CharacterDoc {
  const c = newCharacter();
  const cls = reg.get(classId, "class")!;
  c.identity.name = "Tester";
  Object.assign(c.build, {
    classId, subclassId, ancestry: { kind: "single", id: "srd/ancestry/elf" }, communityId: "srd/community/highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    gear: { primaryId, secondaryId, armorId: "srd/armor/leather-armor", potion: "health", classItem: cls.classItems[0], spellItem: "", extraItems: "" },
    domainCardIds: reg.all("domain-card").filter((x) => cls.domainIds.includes(x.domainId) && x.level === 1).slice(0, 2).map((x) => x.id),
  });
  c.build.experiences[0].name = "First";
  c.build.experiences[1].name = "Second";
  return c;
}
const ranger = (p = "srd/weapon/broadsword", s: string | null = null) => finishBuild(hero("srd/class/ranger", "srd/subclass/wayfinder", p, s), reg);
const warrior = (p = "srd/weapon/greatsword", s: string | null = null) => finishBuild(hero("srd/class/warrior", "srd/subclass/call-of-the-brave", p, s), reg);

describe("secondary weapon alongside the primary (SRD p. 55)", () => {
  it("equips a secondary next to a one-handed primary, straight from the list", () => {
    const r = equipWeapon(ranger(), reg, "srd/weapon/small-dagger", true);
    expect([r.doc.state.activePrimaryId, r.doc.state.activeSecondaryId]).toEqual(["srd/weapon/broadsword", "srd/weapon/small-dagger"]);
    expect(r.doc.state.inventoryWeaponIds).toEqual([]);
    expect(r.doc.state.stressMarked).toBe(0);
  });

  it("burden: a two-handed primary and a secondary can't both be active", () => {
    const withSecondary = equipWeapon(ranger(), reg, "srd/weapon/small-dagger", true).doc;
    const twoHanded = equipWeapon(withSecondary, reg, "srd/weapon/longbow", true);
    expect(twoHanded.doc.state.activePrimaryId).toBe("srd/weapon/longbow");
    expect(twoHanded.doc.state.activeSecondaryId).toBeNull();
    expect(twoHanded.doc.state.inventoryWeaponIds.sort()).toEqual(["srd/weapon/broadsword", "srd/weapon/small-dagger"]);
    expect(twoHanded.notes.join()).toMatch(/no hand free/);
    const back = equipWeapon(ranger("srd/weapon/longbow"), reg, "srd/weapon/small-dagger", true);
    expect([back.doc.state.activePrimaryId, back.doc.state.activeSecondaryId]).toEqual([null, "srd/weapon/small-dagger"]);
    expect(back.doc.state.inventoryWeaponIds).toEqual(["srd/weapon/longbow"]);
  });

  it("Warriors ignore burden (Combat Training): two-handed primary plus a secondary", () => {
    const w = warrior();
    expect(derive(w, reg).ignoresBurden).toBe(true);
    const r = equipWeapon(w, reg, "srd/weapon/small-dagger", true);
    expect([r.doc.state.activePrimaryId, r.doc.state.activeSecondaryId]).toEqual(["srd/weapon/greatsword", "srd/weapon/small-dagger"]);
    expect(derive(ranger(), reg).ignoresBurden).toBe(false);
  });

  it("multiclassing into Warrior grants Combat Training too", () => {
    const draft = hero("srd/class/wizard", "srd/subclass/school-of-war", "srd/weapon/greatstaff");
    draft.build.featureChoices["strange-patterns"] = "7";
    const c = finishBuild(draft, reg);
    c.levelUps = [2, 3, 4, 5].map((level) => ({ level, advancements: level === 5 ? [{ optionId: "multiclass", classId: "srd/class/warrior", domainId: "srd/domain/blade", subclassId: "srd/subclass/call-of-the-brave" }] : [{ optionId: "hp" }, { optionId: "stress" }], domainCardId: null, exchange: null }));
    expect(derive(c, reg).ignoresBurden).toBe(true);
  });

  it("the builder allows a Warrior's two-handed primary with a secondary, and nobody else's", () => {
    const err = (c: CharacterDoc) => validateBuild(c, reg).filter((i) => i.severity === "error").map((i) => i.message);
    expect(err(hero("srd/class/warrior", "srd/subclass/call-of-the-brave", "srd/weapon/greatsword", "srd/weapon/small-dagger"))).toEqual([]);
    expect(err(hero("srd/class/ranger", "srd/subclass/wayfinder", "srd/weapon/longbow", "srd/weapon/small-dagger"))).toContain("Longbow is two-handed, so you can't also carry a secondary weapon.");
  });

  it("replacing a weapon moves the old one to inventory; refuses when inventory is full", () => {
    const c = ranger();
    const r = equipWeapon(c, reg, "srd/weapon/longsword", true);
    expect(r.doc.state.inventoryWeaponIds).toEqual(["srd/weapon/broadsword"]);
    const full = structuredClone(c);
    full.state.inventoryWeaponIds = ["srd/weapon/dagger", "srd/weapon/mace"];
    expect(() => equipWeapon(full, reg, "srd/weapon/longsword", true)).toThrow(/Drop one first/);
    expect(() => unequipWeapon(full, "primary")).toThrow(/only 2/);
  });

  it("costs a Stress in danger; respects tier and Beastform", () => {
    expect(equipWeapon(ranger(), reg, "srd/weapon/small-dagger", false).doc.state.stressMarked).toBe(1);
    expect(() => equipWeapon(ranger(), reg, "srd/weapon/improved-small-dagger", true)).toThrow(/Tier 2/);
    const druid = finishBuild(hero("srd/class/druid", "srd/subclass/warden-of-renewal", "srd/weapon/broadsword"), reg);
    expect(() => equipWeapon(transform(druid, reg, "srd/beastform/agile-scout").doc, reg, "srd/weapon/small-dagger", true)).toThrow(/Beastform/);
  });

  it("Gear tab shows a primary and a secondary slot", () => {
    const c = equipWeapon(warrior(), reg, "srd/weapon/small-dagger", true).doc;
    createLocal(c, null);
    const html = renderToString(
      <ContentContext.Provider value={{ registry: reg, search: new SearchIndex(reg), enabledPacks: ["srd"], setPackEnabled: () => {} }}>
        <MemoryRouter initialEntries={[`/characters/${c.id}?tab=gear`]}><Routes><Route path="/characters/:id" element={<SheetPage />} /></Routes></MemoryRouter>
      </ContentContext.Provider>,
    ).replace(/<!-- -->/g, "");
    expect(html).toContain("Primary weapon</h3>");
    expect(html).toContain("Secondary weapon</h3>");
    expect(html).toContain("<strong>Small Dagger</strong>");
    expect(html).toContain("Combat Training: you ignore burden");
    expect(html).toContain("Change secondary weapon…");
  });
});
