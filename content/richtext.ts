// Inline tags inside RichText: {{term:<slug>|label}} and {{ref:<entry-id>|label}}.
// Shared by the validator, the importer and the UI renderer.

export type RichToken =
  | { kind: "text"; text: string }
  | { kind: "term"; slug: string; label: string }
  | { kind: "ref"; id: string; label?: string };

const TAG = /\{\{(term|ref):([^|}]+)(?:\|([^}]*))?\}\}/g;

export function tokenize(s: string): RichToken[] {
  const out: RichToken[] = [];
  let last = 0;
  for (const m of s.matchAll(TAG)) {
    if (m.index! > last) out.push({ kind: "text", text: s.slice(last, m.index) });
    if (m[1] === "term") out.push({ kind: "term", slug: m[2], label: m[3] ?? m[2] });
    else out.push({ kind: "ref", id: m[2], ...(m[3] ? { label: m[3] } : {}) });
    last = m.index! + m[0].length;
  }
  if (last < s.length) out.push({ kind: "text", text: s.slice(last) });
  return out;
}

/** Text with tags replaced by their labels (for search indexing and plain display). */
export function stripTags(s: string): string {
  return s.replace(TAG, (_, kind, target, label) => label ?? target);
}

/** Leftover braces that aren't a well-formed tag. */
export function malformedTags(s: string): string[] {
  return s.replace(TAG, "").match(/\{\{[^}]*\}?\}?/g) ?? [];
}

/** Every string under a RichText-bearing key ("text", "achievements") in an entry. */
export function richTextFields(v: unknown, key = "", path = ""): { path: string; text: string }[] {
  if (typeof v === "string") return ["text", "achievements"].includes(key) ? [{ path, text: v }] : [];
  if (Array.isArray(v)) return v.flatMap((x, i) => richTextFields(x, key, `${path}[${i}]`));
  if (v && typeof v === "object") return Object.entries(v).flatMap(([k, x]) => richTextFields(x, k, path ? `${path}.${k}` : k));
  return [];
}
