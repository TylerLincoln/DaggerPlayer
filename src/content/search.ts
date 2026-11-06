import MiniSearch from "minisearch";
import type { Entry } from "../../content/schema/index.ts";
import { type Facets, plainText, type Registry } from "./registry.ts";

export interface SearchFilters {
  type?: string;
  tier?: number;
  domain?: string;
  class?: string;
  source?: string;
}

export interface Hit {
  entry: Entry;
  facets: Facets;
  score: number;
}

/** Full-text search over a registry. Filters apply to every query, including an empty one (browse mode). */
export class SearchIndex {
  private mini: MiniSearch<{ id: string; name: string; aliases: string; text: string }>;
  private facets = new Map<string, Facets>();

  constructor(private reg: Registry) {
    this.mini = new MiniSearch({
      fields: ["name", "aliases", "text"],
      storeFields: [],
      searchOptions: { boost: { name: 4, aliases: 3 }, prefix: true, fuzzy: 0.15, combineWith: "AND" },
    });
    const docs = [...reg.byId.values()].map((e) => {
      this.facets.set(e.id, reg.facets(e));
      return { id: e.id, name: e.name, aliases: e.type === "glossary" ? e.aliases.join(" ") : "", text: plainText(e) };
    });
    this.mini.addAll(docs);
  }

  search(query: string, filters: SearchFilters, limit = 200): { hits: Hit[]; total: number } {
    const match = (id: string) => {
      const f = this.facets.get(id)!;
      return (
        (!filters.type || f.type === filters.type) &&
        (!filters.tier || f.tier === filters.tier) &&
        (!filters.domain || f.domains.includes(filters.domain)) &&
        (!filters.class || f.classes.includes(filters.class)) &&
        (!filters.source || f.pack === filters.source)
      );
    };
    let hits: Hit[];
    if (query.trim()) {
      hits = this.mini
        .search(query, { filter: (r) => match(r.id) })
        .map((r) => ({ entry: this.reg.byId.get(r.id)!, facets: this.facets.get(r.id)!, score: r.score }));
    } else {
      hits = [...this.reg.byId.values()]
        .filter((e) => match(e.id))
        .sort((a, b) => a.type.localeCompare(b.type) || a.name.localeCompare(b.name))
        .map((e) => ({ entry: e, facets: this.facets.get(e.id)!, score: 0 }));
    }
    return { hits: hits.slice(0, limit), total: hits.length };
  }
}
