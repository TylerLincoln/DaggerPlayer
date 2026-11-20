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
import { type CharacterDoc, type LevelUp, newCharacter } from "../src/rules/character.ts";
import { derive, subclassProgress } from "../src/rules/derive.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(reg);

function wayfinder(levelUps: LevelUp[] = []): CharacterDoc {
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
  done.levelUps = levelUps;
  return done;
}
const filler = (level: number, extra: LevelUp["advancements"] = [{ optionId: "hp" }, { optionId: "stress" }]): LevelUp => ({ level, advancements: extra, domainCardId: null, exchange: null });

describe("subclass progress (SRD p. 9, 54)", () => {
  it("level 1: Foundation only; the Specialization comes from level 5", () => {
    const [p] = subclassProgress(wayfinder(), reg);
    expect(p.cards.map((x) => [x.stage, x.acquired, x.level])).toEqual([["foundation", true, 1], ["specialization", false, null], ["mastery", false, null]]);
    expect(p.next).toEqual({ stage: "specialization", hint: expect.stringMatching(/^From level 5/) });
  });

  it("an upgrade at level 5 unlocks the Specialization; the Mastery is next", () => {
    const c = wayfinder([2, 3, 4].map((l) => filler(l)).concat(filler(5, [{ optionId: "subclass", subclassId: "srd/subclass/wayfinder" }, { optionId: "evasion" }])));
    const [p] = subclassProgress(c, reg);
    expect(p.cards.map((x) => [x.stage, x.acquired, x.level])).toEqual([["foundation", true, 1], ["specialization", true, 5], ["mastery", false, null]]);
    expect(p.next?.stage).toBe("mastery");
    expect(p.next?.hint).toMatch(/^Choose/);
  });

  it("counts an imported upgrade that doesn't name the subclass", () => {
    const c = wayfinder([2, 3, 4].map((l) => filler(l)).concat(filler(5, [{ optionId: "subclass" }, { optionId: "evasion" }])));
    expect(subclassProgress(c, reg)[0].cards[1].acquired).toBe(true);
    expect(derive(c, reg).features.some((f) => f.source === "Wayfinder (specialization)")).toBe(true);
  });

  it("a multiclass subclass stays at its Foundation", () => {
    const c = wayfinder([2, 3, 4].map((l) => filler(l)).concat(filler(5, [{ optionId: "multiclass", classId: "srd/class/warrior", domainId: "srd/domain/blade", subclassId: "srd/subclass/call-of-the-brave" }])));
    const mc = subclassProgress(c, reg).find((p) => p.multiclass)!;
    expect(mc.subclass.name).toBe("Call of the Brave");
    expect(mc.cards.map((x) => x.acquired)).toEqual([true, false, false]);
    expect(mc.next).toBeNull();
  });
});

const render = (path: string, route: string, el: React.ReactNode) =>
  renderToString(
    <ContentContext.Provider value={{ registry: reg, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>
    </ContentContext.Provider>,
  ).replace(/<!-- -->/g, "");

describe("subclass visibility on screen", () => {
  it("the sheet shows the track, locked stages with a preview, and a header summary", () => {
    const c = wayfinder();
    createLocal(c, null);
    const html = render(`/characters/${c.id}?tab=features`, "/characters/:id", <SheetPage />);
    expect(html).toContain("Wayfinder: Foundation ✓ · Specialization · Mastery");
    expect(html).toMatch(/○<\/span> Specialization<span class="kind"> · not yet/);
    expect(html).toContain("From level 5, choose “Take an upgraded subclass card”");
    expect(html).toMatch(/Preview: Elusive Predator/);
  });

  it("the level-up wizard shows the full text of the card you'd gain", () => {
    const c = wayfinder([2, 3, 4].map((l) => filler(l)));
    createLocal(c, null);
    const html = render(`/characters/${c.id}/level-up`, "/characters/:id/level-up", <LevelUpPage />);
    expect(html).toContain("upgraded subclass card"); // the option is offered at level 5
  });
});
