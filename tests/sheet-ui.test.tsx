import fs from "node:fs";
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
import { CharacterDoc } from "../src/rules/character.ts";

const packs = bundledPacks();
const registry = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(registry);
const template = CharacterDoc.parse(JSON.parse(fs.readFileSync("docs/import/character-template.json", "utf8")));
createLocal(template, null);

const sheet = (tab: string) =>
  renderToString(
    <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
      <MemoryRouter initialEntries={[`/characters/${template.id}?tab=${tab}`]}>
        <Routes><Route path="/characters/:id" element={<SheetPage />} /></Routes>
      </MemoryRouter>
    </ContentContext.Provider>,
  ).replace(/<!-- -->/g, "");

describe("sheet (import template character)", () => {
  it("renders every tab without unresolved tags", () => {
    for (const tab of ["play", "cards", "gear", "features", "story"]) {
      const html = sheet(tab);
      expect(html, tab).toContain("Wren Ashdown");
      expect(html, tab).not.toMatch(/\{\{(term|ref):/);
    }
  });

  it("shows the derived numbers on the play tab", () => {
    const html = sheet("play");
    expect(html).toContain("Level 2 Wayfinder Ranger");
    expect(html).toMatch(/Hit Points: 2 of 7 marked/); // Ranger 6 + 1 HP advancement
    expect(html).toMatch(/Hope: 3 of 6/);
    expect(html).toMatch(/Major<\/small> 8–14/); // Leather 6/13 + level 2: Major 8, Severe 15
    expect(html).toMatch(/Severe<\/small> 15\+/);
    expect(html).toContain("2d6+3 phy"); // Shortbow d6+3 at Proficiency 2 (level 2 achievement)
  });

  it("lists loadout cards and inventory", () => {
    expect(sheet("cards")).toContain("Nature’s Tongue");
    expect(sheet("gear")).toContain("Whetstone");
    expect(sheet("features")).toContain("Wayfinder (foundation)");
  });
});
