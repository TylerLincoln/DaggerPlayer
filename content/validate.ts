// Validates content packs: schema, ids, duplicates, cross-entry links and inline tags.
// Used by scripts/validate-packs.ts (CI) and, later, by the homebrew importer.
import { ENTRY_SCHEMAS, type Entry, type EntryType, PackMeta, type Pack } from "./schema/index.ts";
import { malformedTags, richTextFields, tokenize } from "./richtext.ts";

export interface Issue {
  level: "error" | "warning";
  pack: string;
  id?: string;
  message: string;
}

export interface RawPack {
  meta: unknown;
  entries: unknown[];
}

/**
 * Validate packs together, so homebrew packs can link to the packs they require.
 * Returns parsed packs (only entries that passed the schema) and all issues found.
 */
export function validatePacks(raw: RawPack[]): { packs: Pack[]; issues: Issue[] } {
  const issues: Issue[] = [];
  const packs: Pack[] = [];

  // ---- schema ----
  for (const r of raw) {
    const meta = PackMeta.safeParse(r.meta);
    if (!meta.success) {
      issues.push({ level: "error", pack: String((r.meta as { id?: unknown })?.id ?? "?"), message: `pack.json: ${meta.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}` });
      continue;
    }
    const entries: Entry[] = [];
    for (const e of r.entries) {
      const type = (e as { type?: string })?.type as EntryType;
      const id = (e as { id?: string })?.id;
      const schema = ENTRY_SCHEMAS[type];
      if (!schema) {
        issues.push({ level: "error", pack: meta.data.id, id, message: `unknown type "${type}"` });
        continue;
      }
      const res = schema.safeParse(e);
      if (!res.success) {
        for (const i of res.error.issues) issues.push({ level: "error", pack: meta.data.id, id, message: `${i.path.join(".") || "(entry)"}: ${i.message}` });
        continue;
      }
      entries.push(res.data as Entry);
    }
    packs.push({ meta: meta.data, entries });
  }

  // ---- ids ----
  const all = new Map<string, Entry>();
  for (const p of packs) {
    for (const e of p.entries) {
      const [pack, type] = e.id.split("/");
      if (pack !== p.meta.id) issues.push({ level: "error", pack: p.meta.id, id: e.id, message: `id prefix "${pack}" doesn't match pack "${p.meta.id}"` });
      if (e.pack !== p.meta.id) issues.push({ level: "error", pack: p.meta.id, id: e.id, message: `pack field "${e.pack}" doesn't match pack "${p.meta.id}"` });
      if (type !== e.type) issues.push({ level: "error", pack: p.meta.id, id: e.id, message: `id type segment "${type}" doesn't match type "${e.type}"` });
      if (all.has(e.id)) issues.push({ level: "error", pack: p.meta.id, id: e.id, message: "duplicate id" });
      all.set(e.id, e);
      const homebrew = p.meta.kind === "homebrew";
      if (homebrew !== (e.source.kind === "homebrew")) issues.push({ level: "error", pack: p.meta.id, id: e.id, message: `source.kind "${e.source.kind}" in a ${p.meta.kind} pack` });
      if (!homebrew && !e.source.page) issues.push({ level: "error", pack: p.meta.id, id: e.id, message: "missing source page" });
    }
  }
  for (const p of packs) for (const req of p.meta.requires) if (!packs.some((q) => q.meta.id === req)) issues.push({ level: "error", pack: p.meta.id, message: `requires pack "${req}", which isn't loaded` });

  // ---- links ----
  const visible = (p: Pack) => new Set([p.meta.id, ...p.meta.requires]);
  const glossarySlugs = (p: Pack) => {
    const v = visible(p);
    return new Set([...all.values()].filter((e) => e.type === "glossary" && v.has(e.pack)).map((e) => e.id.split("/").pop()!));
  };
  for (const p of packs) {
    const v = visible(p);
    const terms = glossarySlugs(p);
    const err = (e: Entry, message: string) => issues.push({ level: "error", pack: p.meta.id, id: e.id, message });
    const link = (e: Entry, field: string, target: string | null | undefined, type?: EntryType) => {
      if (!target) return;
      const t = all.get(target);
      if (!t) return err(e, `${field} → ${target} does not exist`);
      if (!v.has(t.pack)) return err(e, `${field} → ${target} is in pack "${t.pack}", which this pack doesn't require`);
      if (type && t.type !== type) err(e, `${field} → ${target} is a ${t.type}, expected ${type}`);
    };

    for (const e of p.entries) {
      switch (e.type) {
        case "class":
          e.domainIds.forEach((d, i) => link(e, `domainIds[${i}]`, d, "domain"));
          e.subclassIds.forEach((s, i) => {
            link(e, `subclassIds[${i}]`, s, "subclass");
            const sub = all.get(s);
            if (sub?.type === "subclass" && sub.classId !== e.id) err(e, `subclass ${s} points at ${sub.classId}, not back at this class`);
          });
          break;
        case "subclass": {
          link(e, "classId", e.classId, "class");
          const cls = all.get(e.classId);
          if (cls?.type === "class" && !cls.subclassIds.includes(e.id)) err(e, `class ${e.classId} doesn't list this subclass`);
          break;
        }
        case "domain-card":
          link(e, "domainId", e.domainId, "domain");
          break;
        case "rules":
          link(e, "parentId", e.parentId, "rules");
          break;
        case "glossary":
          link(e, "sectionId", e.sectionId);
          break;
      }
      for (const { path, text } of richTextFields(e)) {
        for (const bad of malformedTags(text)) err(e, `${path}: malformed tag ${bad}`);
        for (const t of tokenize(text)) {
          if (t.kind === "term" && !terms.has(t.slug)) err(e, `${path}: unknown term "${t.slug}"`);
          if (t.kind === "ref") link(e, path, t.id);
        }
      }
    }
  }

  // ---- shape checks the schema can't express ----
  for (const p of packs) {
    if (p.meta.kind === "homebrew") continue;
    const domainsUsed = new Map<string, number>();
    for (const e of p.entries) if (e.type === "class") for (const d of e.domainIds) domainsUsed.set(d, (domainsUsed.get(d) ?? 0) + 1);
    for (const e of p.entries) {
      if (e.type === "domain" && !domainsUsed.has(e.id)) issues.push({ level: "warning", pack: p.meta.id, id: e.id, message: "no class grants this domain" });
      if (e.type === "domain") {
        const cards = p.entries.filter((c) => c.type === "domain-card" && c.domainId === e.id);
        if (!cards.length) issues.push({ level: "warning", pack: p.meta.id, id: e.id, message: "domain has no cards" });
      }
    }
  }

  return { packs, issues };
}
