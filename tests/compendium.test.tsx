import { renderToString } from "react-dom/server";
import { MemoryRouter, Route, Routes } from "react-router";
import { describe, expect, it } from "vitest";
import type { Entry, PackMeta } from "../content/schema/index.ts";
import { bundledPacks as rawPacks } from "../scripts/validate-packs.ts";
import { ContentContext } from "../src/content/ContentProvider.tsx";
import { entryPath, Registry } from "../src/content/registry.ts";
import { SearchIndex } from "../src/content/search.ts";
import { EntryView } from "../src/features/compendium/EntryView.tsx";
import { CompendiumPage, RulesIndexPage, RulesPage } from "../src/features/compendium/pages.tsx";
import { parseBlocks, RichText } from "../src/ui/RichText.tsx";

const packs = rawPacks();
const registry = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const search = new SearchIndex(registry);

const render = (node: React.ReactNode) =>
  renderToString(
    <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd", "srd-frames"], setPackEnabled: () => {} }}>
      <MemoryRouter>{node}</MemoryRouter>
    </ContentContext.Provider>,
  );

describe("entry pages", () => {
  it("render every entry without errors", () => {
    let n = 0;
    for (const e of registry.byId.values()) {
      if (e.type === "rules") continue; // rules entries redirect to /rules pages
      const html = render(<EntryView e={e} />);
      expect(html, e.id).toContain(e.name.replace(/&/g, "&amp;").replace(/'/g, "&#x27;"));
      expect(html, e.id).not.toMatch(/\{\{(term|ref):/); // every tag rendered
      n++;
    }
    expect(n).toBeGreaterThan(1300);
  });

  it("link a domain card to its domain and classes", () => {
    const html = render(<EntryView e={registry.byId.get("srd/domain-card/book-of-ava")!} />);
    expect(html).toContain('href="/compendium/srd/domain/codex"');
    expect(html).toContain('href="/compendium/srd/class/bard"');
    expect(html).toContain('href="/compendium/srd/class/wizard"');
  });

  it("link rules terms to glossary entries", () => {
    const html = render(<EntryView e={registry.byId.get("srd/class/assassin")!} />);
    expect(html).toContain('href="/compendium/srd/glossary/stress"');
  });

  it("render every rules page with contents and prev/next", () => {
    const rules = registry.all("rules");
    for (const r of rules) {
      const html = renderToString(
        <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd", "srd-frames"], setPackEnabled: () => {} }}>
          <MemoryRouter initialEntries={[entryPath(r)]}>
            <Routes><Route path="/rules/:pack/:slug" element={<RulesPage />} /></Routes>
          </MemoryRouter>
        </ContentContext.Provider>,
      );
      expect(html, r.id).toContain('id="rules-title"');
      expect(html, r.id).not.toMatch(/\{\{(term|ref):/);
    }
    expect(rules.length).toBe(185);
  });

  it("render the rules index and the compendium search page", () => {
    expect(render(<RulesIndexPage />)).toContain("Daggerheart SRD 2.0");
    const html = renderToString(
      <ContentContext.Provider value={{ registry, search, enabledPacks: ["srd"], setPackEnabled: () => {} }}>
        <MemoryRouter initialEntries={["/compendium?q=hope&type=glossary"]}>
          <Routes><Route path="/compendium" element={<CompendiumPage />} /></Routes>
        </MemoryRouter>
      </ContentContext.Provider>,
    );
    expect(html).toContain('href="/compendium/srd/glossary/hope"');
  });

  it("route rules sections to the rules reader", () => {
    expect(entryPath(registry.byId.get("srd/rules/downtime")!)).toBe("/rules/srd/downtime");
  });
});

describe("search", () => {
  const names = (q: string, f = {}) => search.search(q, f).hits.map((h) => h.entry.name);

  it("finds by name, with prefix and small typos", () => {
    expect(names("vulnerable")[0]).toBe("Vulnerable");
    expect(names("longsw")).toContain("Longsword");
    expect(names("broadsowrd")).toContain("Broadsword");
  });

  it("searches full text", () => {
    expect(names("Marked for Death")).toContain("Assassin");
  });

  it("filters by type, tier, domain, class and source", () => {
    const r = search.search("", { type: "domain-card", class: "srd/class/witch", tier: 1 });
    expect(r.hits.length).toBe(6); // 3 level-1 cards in each of Dread and Sage
    expect(r.hits.every((h) => ["srd/domain/dread", "srd/domain/sage"].includes((h.entry as { domainId: string }).domainId))).toBe(true);
    expect(search.search("", { type: "weapon", tier: 4 }).hits.every((h) => h.facets.tier === 4)).toBe(true);
    expect(search.search("", { source: "srd-frames" }).hits.every((h) => h.entry.pack === "srd-frames")).toBe(true);
  });
});

describe("rich text", () => {
  it("parses headings, lists, numbered lists and tables", () => {
    expect(parseBlocks("### Title\n\n- a\n- b\n\n1. x\n2. y\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n\npara")).toEqual([
      { kind: "h", level: 3, text: "Title" },
      { kind: "ul", items: ["a", "b"] },
      { kind: "ol", items: ["x", "y"] },
      { kind: "table", head: ["A", "B"], rows: [["1", "2"]] },
      { kind: "p", text: "para" },
    ]);
  });

  it("renders bold, italic and nested markers", () => {
    const html = render(<RichText text={"**_Note:_** _keep_ snake_case **{{term:stress|Stress}}**"} />);
    expect(html).toContain("<strong><em>Note:</em></strong>");
    expect(html).toContain("<em>keep</em>");
    expect(html).toContain("snake_case");
    expect(html).toMatch(/<strong><span class="term">/);
  });
});
