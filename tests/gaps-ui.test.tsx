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
import { SheetPage } from "../src/features/sheet/SheetPage.tsx";
import { finishBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, newCharacter } from "../src/rules/character.ts";
import { transform } from "../src/rules/sheet.ts";

const packs = bundledPacks();
const registry = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(registry);

function hero(classId: string, subclassId: string, over: (c: CharacterDoc) => void = () => {}, finish = true): CharacterDoc {
  const c = newCharacter();
  const cls = registry.get(classId, "class")!;
  c.identity.name = "Tester";
  Object.assign(c.build, {
    classId, subclassId, ancestry: { kind: "single", id: "srd/ancestry/elf" }, communityId: "srd/community/highborne",
    traits: { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 },
    gear: { primaryId: "srd/weapon/broadsword", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "health", classItem: cls.classItems[0], spellItem: "", extraItems: "" },
    domainCardIds: registry.all("domain-card").filter((x) => cls.domainIds.includes(x.domainId) && x.level === 1).slice(0, 2).map((x) => x.id),
  });
  c.build.experiences[0].name = "First";
  c.build.experiences[1].name = "Second";
  over(c);
  const done = finish ? finishBuild(c, registry) : c;
  createLocal(done, null);
  return done;
}

const page = (path: string, route: string, el: React.ReactNode) =>
  renderToString(
    <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
      <MemoryRouter initialEntries={[path]}><Routes><Route path={route} element={el} /></Routes></MemoryRouter>
    </ContentContext.Provider>,
  ).replace(/<!-- -->/g, "");
const sheet = (c: CharacterDoc, tab = "play") => page(`/characters/${c.id}?tab=${tab}`, "/characters/:id", <SheetPage />);

describe("sheet extras", () => {
  it("Warlock: Favor counter, Patron Die, patron choices on the Features tab", () => {
    const w = hero("srd/class/warlock", "srd/subclass/pact-of-the-endless", (c) => (c.build.featureChoices = { "patron-name": "The Hollow Queen", "patron-sphere": "Secrets" }));
    const html = sheet(w);
    expect(html).toContain('aria-label="Favor: 3 of 6"');
    expect(html).toContain("Patron Die:</strong> d6");
    expect(sheet(w, "features")).toContain('value="The Hollow Queen"');
  });

  it("Druid: Beastform panel; in form, weapons are blocked and the form attack is offered", () => {
    const dr = hero("srd/class/druid", "srd/subclass/warden-of-renewal");
    expect(sheet(dr)).toContain("Choose a form…");
    const inForm = transform(dr, registry, "srd/beastform/agile-scout").doc;
    inForm.id = crypto.randomUUID();
    createLocal(inForm, null);
    const html = sheet(inForm);
    expect(html).toContain("Attack as Agile Scout");
    expect(html).toContain("you can&#x27;t use weapons until you drop out");
  });

  it("Brawler with no weapons gets Brawler's Strike", () => {
    const b = hero("srd/class/brawler", "srd/subclass/juggernaut", (c) => { c.build.gear.primaryId = null; c.build.featureChoices["brawler-strike-trait"] = "strength"; });
    expect(sheet(b)).toContain("Attack with Brawler’s Strike");
  });

  it("limited-use features get a Used checkbox", () => {
    const bard = hero("srd/class/bard", "srd/subclass/troubadour");
    expect(sheet(bard, "features")).toContain("Used this session"); // Rally: once per session
  });

  it("Beastbound: companion editor in the builder, companion panel on the sheet", () => {
    const draft = hero("srd/class/ranger", "srd/subclass/beastbound", () => {}, false);
    expect(page(`/build/${draft.id}/background`, "/build/:id/:step", <BuilderPage />)).toContain("Your companion");
    const r = hero("srd/class/ranger", "srd/subclass/beastbound", (c) => {
      c.state.companion = { name: "Ash", kind: "Wolf", experiences: [{ id: "a", name: "Scout", bonus: 2 }, { id: "b", name: "Loyal", bonus: 2 }], attack: "Bite", damageType: "phy", baseStress: 3, stressMarked: 1 };
    });
    const html = sheet(r);
    expect(html).toContain("Companion: Ash");
    expect(html).toContain('aria-label="Companion Stress: 1 of 3 marked"');
    expect(html).toContain("Command Ash to attack");
  });
});
