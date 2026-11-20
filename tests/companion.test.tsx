import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { ContentContext } from "../src/content/ContentProvider.tsx";
import { Registry } from "../src/content/registry.ts";
import { SearchIndex } from "../src/content/search.ts";
import { createLocal } from "../src/data/characters.ts";
import { LevelUpPage } from "../src/features/levelup/LevelUpPage.tsx";
import { SheetPage } from "../src/features/sheet/SheetPage.tsx";
import { finishBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { companionErrors, companionGaps, emptyLevelUp, setCompanionLevelUp, validateLevelUp } from "../src/rules/levelup.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(reg);

/** A Beastbound Ranger at `level`, with level-ups that have no companion choices (like an import). */
function beastbound(level: number, withCompanion = true): CharacterDoc {
  const c = newCharacter();
  c.identity.name = "Wren";
  Object.assign(c.build, {
    classId: "srd/class/ranger", subclassId: "srd/subclass/beastbound", ancestry: { kind: "single", id: "srd/ancestry/elf" }, communityId: "srd/community/highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    gear: { primaryId: "srd/weapon/shortbow", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "health", classItem: "A trophy from your first kill", spellItem: "", extraItems: "" },
    domainCardIds: ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"],
  });
  c.build.experiences[0].name = "Tracker";
  c.build.experiences[1].name = "Survivalist";
  c.state.companion = { name: "Ash", kind: "Wolf", experiences: [{ id: "x1", name: "Scout", bonus: 2 }, { id: "x2", name: "Loyal", bonus: 2 }], attack: "Bite", damageType: "phy", baseStress: null, stressMarked: 0 };
  const done = finishBuild(c, reg);
  if (!withCompanion) done.state.companion = null; // e.g. imported without a companion
  done.levelUps = Array.from({ length: level - 1 }, (_, i) => ({ level: i + 2, advancements: [{ optionId: "hp" }, { optionId: "stress" }], domainCardId: null, exchange: null }));
  return done;
}

describe("leveling up a Ranger companion (SRD p. 22)", () => {
  it("finds levels with no companion choice and fills them in, one option each", () => {
    let c = beastbound(3);
    expect(companionGaps(c, reg)).toEqual([2, 3]);
    expect(() => setCompanionLevelUp(c, reg, 2, "aware")).toThrow(/new Experience at \+2/); // level 2 is a tier achievement
    c = setCompanionLevelUp(c, reg, 2, "aware", { name: "Tracker" });
    expect(() => setCompanionLevelUp(c, reg, 3, "aware")).toThrow(/already has that option/);
    c = setCompanionLevelUp(c, reg, 3, "vicious:die");
    expect(companionGaps(c, reg)).toEqual([]);
    const k = derive(c, reg).companion!;
    expect([k.evasion.total, k.die, k.stressMax?.total, k.experiences.map((x) => x.name)]).toEqual([12, "d8", 3, ["Scout", "Loyal", "Tracker"]]);
  });

  it("changing a level's own choice doesn't count against itself", () => {
    let c = setCompanionLevelUp(beastbound(2), reg, 2, "aware", { name: "Tracker" });
    c = setCompanionLevelUp(c, reg, 2, "resilient", { name: "Tracker" });
    expect(c.levelUps[0].companionOption).toBe("resilient");
    expect(c.levelUps[0].companionExperience?.name).toBe("Tracker");
  });

  it("Intelligent must name one of the companion's Experiences", () => {
    const c = beastbound(3);
    expect(companionErrors(c, 3, "intelligent:nope")).toContain("Intelligent: choose a Companion Experience.");
    expect(companionErrors(c, 3, "intelligent:x1")).toEqual([]);
  });

  it("the wizard requires a companion before leveling up a Beastbound Ranger", () => {
    const c = beastbound(1, false);
    const lu = { ...emptyLevelUp(c), advancements: [{ optionId: "hp" }, { optionId: "stress" }], domainCardId: "srd/domain-card/natures-tongue" };
    lu.newExperience!.name = "Lesson";
    expect(validateLevelUp(c, lu, reg)).toContain("Set up your companion (Beastbound) before leveling up.");
  });
});

const render = (path: string, route: string, el: React.ReactNode) =>
  renderToString(
    <ContentContext.Provider value={{ registry: reg, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>
    </ContentContext.Provider>,
  ).replace(/<!-- -->/g, "");

describe("companion level-up screens", () => {
  it("the sheet flags levels missing a companion choice", () => {
    const c = beastbound(3);
    createLocal(c, null);
    const html = render(`/characters/${c.id}`, "/characters/:id", <SheetPage />);
    expect(html).toContain("2 levels need a choice");
    expect(html).toContain("<strong>Level 2:</strong> not chosen");
  });

  it("the level-up wizard sets up a missing companion inline", () => {
    const c = beastbound(1, false);
    createLocal(c, null);
    const html = render(`/characters/${c.id}/level-up`, "/characters/:id/level-up", <LevelUpPage />);
    expect(html).toContain("it hasn&#x27;t been set up yet");
    expect(html).toContain("Your companion");
  });

  it("the level-up wizard offers the options, with taken ones disabled", () => {
    const c = setCompanionLevelUp(beastbound(2), reg, 2, "aware", { name: "Tracker" });
    createLocal(c, null);
    const html = render(`/characters/${c.id}/level-up`, "/characters/:id/level-up", <LevelUpPage />);
    expect(html).toContain("Companion option for level 3");
    expect(html).toMatch(/disabled=""[^>]*\/>\s*<span><strong>Aware<\/strong>[\s\S]*?taken at another level/);
  });
});
