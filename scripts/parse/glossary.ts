// Glossary terms (curated list in content/srd/glossary-terms.json) and automatic term tagging.
import fs from "node:fs";
import type { Entry, EntryOf } from "../../content/schema/index.ts";
import { src, PACK } from "./common.ts";

interface TermDef {
  slug: string;
  name: string;
  aliases: string[];
  /** rules section by name; "Parent > Child" picks a child; "Section#Sub" picks a ### subheading inside it */
  section?: string;
  condition?: string;
  /** phrase that picks the defining sentence when the first mention isn't it */
  match?: string;
}

export function loadTermDefs(file = "content/srd/glossary-terms.json"): TermDef[] {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function findSection(rules: EntryOf<"rules">[], path: string): { entry: EntryOf<"rules">; text: string } {
  const [secPath, sub] = path.split("#");
  const parts = secPath.split(">").map((s) => s.trim().toLowerCase());
  const name = parts[parts.length - 1];
  const parentName = parts.length > 1 ? parts[0] : null;
  const candidates = rules.filter((r) => r.name.toLowerCase() === name && (!parentName || rules.find((p) => p.id === r.parentId)?.name.toLowerCase() === parentName));
  if (candidates.length !== 1) throw new Error(`glossary: section "${path}" matched ${candidates.length} rules entries`);
  const entry = candidates[0];
  if (!sub) return { entry, text: entry.text };
  // text under "### Sub" up to the next heading
  const m = entry.text.split(/\n(?=#{2,4} )/).find((chunk) => new RegExp(`^#{2,4} ${escapeRe(sub)}\\s*$`, "im").test(chunk.split("\n")[0]));
  if (!m) throw new Error(`glossary: subheading "${sub}" not found in "${entry.name}"`);
  return { entry, text: m.split("\n").slice(1).join("\n") };
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Prose sentences, paragraph by paragraph (skips headings and tables; a full stop may sit inside _ or ** markers). */
function sentences(text: string): string[] {
  return text
    .split("\n")
    .filter((l) => l.trim() && !/^(#|\|)/.test(l.trim()))
    .map((l) => l.replace(/^- /, ""))
    .flatMap((para) => para.split(/(?<=[.!?](?:_|\*\*|_\*\*|\*\*_)?)\s+(?=[A-Z_*“"])/))
    .map((s) => s.trim())
    .filter(Boolean);
}

export function buildGlossary(rules: EntryOf<"rules">[], conditions: EntryOf<"condition">[]): EntryOf<"glossary">[] {
  return loadTermDefs().map((t) => {
    let summary: string;
    let sectionId: string;
    let page: number | undefined;
    if (t.condition) {
      const c = conditions.find((x) => x.name === t.condition);
      if (!c) throw new Error(`glossary: condition ${t.condition} not found`);
      summary = sentences(c.text)[0];
      sectionId = c.id;
      page = c.source.page;
    } else {
      const { entry, text } = findSection(rules, t.section!);
      const re = new RegExp(t.aliases.map((a) => `\\b${escapeRe(a)}\\b`).join("|"));
      const all = sentences(text);
      // the first sentence that names the term; a subsection's own first sentence when it never repeats its name
      const flat = (s: string) => s.replace(/\*\*|_/g, "");
      const hit = t.match
        ? all.find((s) => flat(s).includes(t.match!))
        : (all.find((s) => re.test(flat(s))) ?? (t.section!.includes("#") ? all[0] : undefined));
      if (!hit) throw new Error(`glossary: no sentence mentioning ${t.name} in "${t.section}"`);
      // with a match phrase, start the summary at that phrase (style markers may sit between its letters)
      const start = t.match ? hit.search(new RegExp("[*_]*" + [...t.match].map((c) => escapeRe(c)).join("[*_]*"))) : 0;
      summary = hit.slice(Math.max(0, start)).trim();
      sectionId = entry.id;
      page = entry.source.page;
    }
    return {
      id: `${PACK}/glossary/${t.slug}`, type: "glossary", name: t.name, pack: PACK, source: src(page!),
      aliases: t.aliases, summary, sectionId,
    };
  });
}

/**
 * Wrap rules terms in {{term:slug|label}}. Longest aliases win. Text inside existing {{…}} tags,
 * markdown headings, and the glossary entries themselves is left alone.
 */
export function autotag(entries: Entry[], glossary: EntryOf<"glossary">[]): Record<string, number> {
  const bySlug = new Map<string, string>();
  const aliases: [string, string][] = [];
  for (const g of glossary) {
    const slug = g.id.split("/").pop()!;
    for (const a of g.aliases) aliases.push([a, slug]);
    bySlug.set(slug, g.name);
  }
  aliases.sort((a, b) => b[0].length - a[0].length);
  const lookup = new Map(aliases);
  const re = new RegExp(`(?<![\\p{L}\\d{|:-])(${aliases.map(([a]) => escapeRe(a)).join("|")})(?![\\p{L}\\d}-])`, "gu");
  const stats: Record<string, number> = {};

  const tag = (s: string) =>
    s
      .split("\n")
      .map((line) =>
        /^#{1,4} /.test(line)
          ? line
          : line
              .split(/(\{\{[^}]*\}\})/)
              .map((part, i) =>
                i % 2
                  ? part
                  : part.replace(re, (m) => {
                      const slug = lookup.get(m)!;
                      stats[slug] = (stats[slug] ?? 0) + 1;
                      return `{{term:${slug}|${m}}}`;
                    }),
              )
              .join(""),
      )
      .join("\n");

  const walk = (v: unknown, key = ""): unknown => {
    if (typeof v === "string") return ["text", "achievements"].includes(key) ? tag(v) : v;
    if (Array.isArray(v)) return v.map((x) => walk(x, key === "questions" ? "" : key));
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) (v as Record<string, unknown>)[k] = walk(x, k);
    }
    return v;
  };
  for (const e of entries) if (e.type !== "glossary") walk(e);
  return stats;
}
