import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { ContentContext } from "../src/content/ContentProvider.tsx";
import { Registry } from "../src/content/registry.ts";
import { SearchIndex } from "../src/content/search.ts";
import { createLocal } from "../src/data/characters.ts";
import { BuilderPage } from "../src/features/builder/BuilderPage.tsx";
import { BUILDER_STEPS } from "../src/rules/builder.ts";
import { newCharacter } from "../src/rules/character.ts";

const packs = bundledPacks();
const registry = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(registry);

const page = (id: string, step: string) =>
  renderToString(
    <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
      <MemoryRouter initialEntries={[`/build/${id}/${step}`]}>
        <Routes><Route path="/build/:id/:step" element={<BuilderPage />} /></Routes>
      </MemoryRouter>
    </ContentContext.Provider>,
  );

describe("builder pages", () => {
  const empty = newCharacter();
  createLocal(empty, null);
  const full = newCharacter();
  Object.assign(full.build, {
    classId: "srd/class/ranger", subclassId: "srd/subclass/wayfinder", ancestry: { kind: "single", id: "srd/ancestry/human" }, communityId: "srd/community/highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    gear: { primaryId: "srd/weapon/shortbow", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "health", classItem: "A trophy from your first kill", spellItem: "", extraItems: "" },
    domainCardIds: ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"],
    background: [{ question: "Q?", answer: "A." }], connections: [{ question: "C?", answer: "B." }],
  });
  full.identity.name = "Wren";
  full.build.experiences[0].name = "Tracker";
  full.build.experiences[1].name = "Survivalist";
  createLocal(full, null);

  it("render every step for an empty and a complete character", () => {
    for (const s of BUILDER_STEPS) {
      expect(page(empty.id, s.id), s.id).toContain('class="builder"');
      expect(page(full.id, s.id), s.id).toContain("Wren");
    }
  });

  it("previews stat changes on options", () => {
    const html = page(full.id, "heritage");
    expect(html).toMatch(/Simiah[\s\S]*?\+1 Evasion/);
  });

  it("review lists what's missing and only enables Finish when complete", () => {
    const e = page(empty.id, "review");
    expect(e).toContain("Choose a class.");
    expect(e).toMatch(/<button[^>]*disabled=""[^>]*>Finish character/);
    const f = page(full.id, "review");
    expect(f).not.toContain("Still missing");
    expect(f).toMatch(/<button[^>]*class="primary"[^>]*>Finish character/);
    expect(f).not.toMatch(/disabled=""[^>]*>Finish character/);
  });

  it("marks completed steps in the progress bar", () => {
    const f = page(full.id, "class");
    expect(f).toContain('aria-valuenow="7"');
  });
});
