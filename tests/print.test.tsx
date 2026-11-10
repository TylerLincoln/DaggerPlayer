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
import { PrintPage } from "../src/features/sheet/PrintPage.tsx";
import { CharacterDoc } from "../src/rules/character.ts";

const packs = bundledPacks();
const registry = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(registry);
const c = CharacterDoc.parse(JSON.parse(fs.readFileSync("docs/import/character-template.json", "utf8")));
c.id = crypto.randomUUID();
createLocal(c, null);

const html = renderToString(
  <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
    <MemoryRouter initialEntries={[`/characters/${c.id}/print`]}>
      <Routes><Route path="/characters/:id/print" element={<PrintPage />} /></Routes>
    </MemoryRouter>
  </ContentContext.Provider>,
).replace(/<!-- -->/g, "");
const sheet = html.slice(html.indexOf('<article class="print-sheet"'));

describe("printable sheet", () => {
  it("has every section", () => {
    for (const h of ["Damage thresholds", "Traits", "Experiences", "Weapons and armor", "Inventory", "Gold", "Domain cards", "Features", "Background", "Connections", "Notes"]) expect(sheet, h).toContain(`<h2>${h}</h2>`);
    expect(sheet).toContain("Wren Ashdown");
    expect(sheet).toContain("Level 2 Wayfinder Ranger");
  });

  it("prints trackers as currently marked", () => {
    expect(sheet).toContain('aria-label="Hit Points: 2 of 7"');
    expect(sheet).toContain('aria-label="Hope: 3 of 6"');
    const hp = sheet.slice(sheet.indexOf('aria-label="Hit Points'), sheet.indexOf('aria-label="Stress'));
    expect(hp.match(/p-box on/g)).toHaveLength(2);
  });

  it("includes the DPCGL attribution and modification statement", () => {
    expect(sheet).toContain("This product includes materials from the Daggerheart System Reference Document 2.0");
    expect(sheet).toContain("Darrington Press Community Gaming (DPCGL) License");
    expect(sheet).toContain("Reformatted into structured data");
    expect(sheet).toContain("not affiliated with or endorsed by Darrington Press");
  });

  it("prints full card and feature text with rules terms as plain words", () => {
    expect(sheet).toContain("Nature’s Tongue");
    expect(sheet).toContain("Wayfinder (foundation)");
    expect(sheet).not.toMatch(/\{\{(term|ref):/);
    expect(sheet).not.toContain('class="term"');
    expect(sheet).toContain("2d6+3 phy"); // shortbow at Proficiency 2
  });

  it("has a print button outside the printed sheet", () => {
    expect(html.indexOf("Print / Save as PDF")).toBeLessThan(html.indexOf('<article class="print-sheet"'));
  });
});
