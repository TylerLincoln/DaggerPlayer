// In-memory index over the entries of the enabled packs: lookups, back-links and search facets.
import type { Entry, EntryOf, EntryType, PackMeta } from "../../content/schema/index.ts";
import { richTextFields, stripTags } from "../../content/richtext.ts";

export type Facets = { type: EntryType; tier?: number; domains: string[]; classes: string[]; pack: string };

/** Domain card levels map onto tiers the same way character levels do. */
export const tierOfLevel = (level: number) => (level <= 1 ? 1 : level <= 4 ? 2 : level <= 7 ? 3 : 4);

export class Registry {
  readonly byId = new Map<string, Entry>();
  readonly byType = new Map<EntryType, Entry[]>();
  readonly glossary = new Map<string, EntryOf<"glossary">>();
  readonly packs: PackMeta[];
  private children = new Map<string, Entry[]>();

  constructor(entries: Entry[], packs: PackMeta[]) {
    this.packs = packs;
    for (const e of entries) {
      this.byId.set(e.id, e);
      this.byType.set(e.type, [...(this.byType.get(e.type) ?? []), e]);
      if (e.type === "glossary") this.glossary.set(e.id.split("/").pop()!, e);
      const parent = parentOf(e);
      if (parent) this.children.set(parent, [...(this.children.get(parent) ?? []), e]);
    }
    for (const list of this.children.values()) list.sort((a, b) => order(a) - order(b) || a.name.localeCompare(b.name));
  }

  get<K extends EntryType>(id: string | null | undefined, type?: K): EntryOf<K> | undefined {
    const e = id ? this.byId.get(id) : undefined;
    return e && (!type || e.type === type) ? (e as EntryOf<K>) : undefined;
  }

  all<K extends EntryType>(type: K): EntryOf<K>[] {
    return (this.byType.get(type) ?? []) as EntryOf<K>[];
  }

  /** Entries that point at this one: subclasses of a class, cards of a domain, child rules sections. */
  childrenOf(id: string): Entry[] {
    return this.children.get(id) ?? [];
  }

  /** Classes that grant a domain. */
  classesWithDomain(domainId: string): EntryOf<"class">[] {
    return this.all("class").filter((c) => c.domainIds.includes(domainId));
  }

  pack(id: string) {
    return this.packs.find((p) => p.id === id);
  }

  facets(e: Entry): Facets {
    const f: Facets = { type: e.type, domains: [], classes: [], pack: e.pack };
    switch (e.type) {
      case "weapon":
      case "armor":
      case "beastform":
      case "adversary":
      case "environment":
        f.tier = e.tier;
        break;
      case "domain-card":
        f.tier = tierOfLevel(e.level);
        f.domains = [e.domainId];
        f.classes = this.classesWithDomain(e.domainId).map((c) => c.id);
        break;
      case "domain":
        f.domains = [e.id];
        f.classes = this.classesWithDomain(e.id).map((c) => c.id);
        break;
      case "class":
        f.domains = [...e.domainIds];
        f.classes = [e.id];
        break;
      case "subclass": {
        f.classes = [e.classId];
        f.domains = [...(this.get(e.classId, "class")?.domainIds ?? [])];
        break;
      }
    }
    return f;
  }
}

function parentOf(e: Entry): string | null {
  switch (e.type) {
    case "subclass":
      return e.classId;
    case "domain-card":
      return e.domainId;
    case "rules":
      return e.parentId;
    default:
      return null;
  }
}

function order(e: Entry): number {
  if (e.type === "rules") return e.order;
  if (e.type === "domain-card") return e.level;
  return 0;
}

/** Plain searchable text of an entry: every rich-text field, tags and markdown removed. */
export function plainText(e: Entry): string {
  return richTextFields(e)
    .map((f) => stripTags(f.text))
    .join(" ")
    .replace(/\*\*|(^|\W)_|_(?=\W|$)|^#+ |\|/gm, " ")
    .replace(/\s+/g, " ");
}

/** Human label for an entry type. */
export const TYPE_LABELS: Record<EntryType, string> = {
  class: "Class",
  subclass: "Subclass",
  domain: "Domain",
  "domain-card": "Domain card",
  ancestry: "Ancestry",
  community: "Community",
  transformation: "Transformation",
  beastform: "Beastform",
  weapon: "Weapon",
  armor: "Armor",
  item: "Item",
  consumable: "Consumable",
  adversary: "Adversary",
  environment: "Environment",
  progression: "Leveling",
  condition: "Condition",
  glossary: "Rules term",
  rules: "Rules",
};

/** Where an entry lives in the app. Rules sections are read as pages; everything else is a compendium entry. */
export function entryPath(e: Pick<Entry, "id" | "type">): string {
  const [pack, , slug] = e.id.split("/");
  return e.type === "rules" ? `/rules/${pack}/${slug}` : `/compendium/${e.id}`;
}

export function sourceLabel(e: Entry): string {
  if (e.source.kind === "homebrew") return `Homebrew · ${e.source.document}`;
  const pages = e.source.page ? (e.source.pageEnd ? `pp. ${e.source.page}–${e.source.pageEnd}` : `p. ${e.source.page}`) : "";
  return [e.source.document, pages].filter(Boolean).join(" · ");
}
