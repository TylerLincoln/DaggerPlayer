// Adds machine-readable modifiers and choices to features (see content/srd/modifiers.json).
import fs from "node:fs";
import type { Entry, Feature, Modifier } from "../../content/schema/index.ts";
import { plain } from "./lines.ts";

interface ModifierFile {
  features: { id: string; feature: string; modifiers: Modifier[] }[];
  cards: { id: string; modifiers: Modifier[] }[];
  choices: { id: string; feature: string; choice: NonNullable<Feature["choices"]>[number] }[];
  cardChoices: { id: string; choice: NonNullable<Feature["choices"]>[number] }[];
  vaultOnAcquire: string[];
  resources: { id: string; feature: string; resource: NonNullable<Feature["resources"]>[number] }[];
}

const TARGETS: Record<string, Modifier["target"][]> = {
  evasion: ["evasion"],
  "armor score": ["armorScore"],
  "damage thresholds": ["majorThreshold", "severeThreshold"],
  "severe damage threshold": ["severeThreshold"],
  "major damage threshold": ["majorThreshold"],
  agility: ["trait:agility"],
  strength: ["trait:strength"],
  finesse: ["trait:finesse"],
  instinct: ["trait:instinct"],
  presence: ["trait:presence"],
  knowledge: ["trait:knowledge"],
};

/** Equipment features: every clause that is exactly "±N to <stat>" becomes a modifier while equipped. */
export function equipmentModifiers(f: Feature): Modifier[] {
  const out: Modifier[] = [];
  for (const clause of plain(f.text).split(";").map((c) => c.trim().replace(/\.$/, ""))) {
    const m = clause.match(/^([+−–-])(\d+) to (?:your )?([A-Za-z ]+)$/);
    const targets = m && TARGETS[m[3].toLowerCase()];
    if (!m || !targets) continue;
    const value = (m[1] === "+" ? 1 : -1) * Number(m[2]);
    for (const target of targets) out.push({ target, value, when: "equipped" });
  }
  return out;
}

const withDefaults = (ms: Modifier[]) => ms.map((m) => ({ ...m, when: m.when ?? "always" }));

export function applyModifiers(entries: Entry[], file = "content/srd/modifiers.json"): number {
  const data: ModifierFile = JSON.parse(fs.readFileSync(file, "utf8"));
  const byId = new Map(entries.map((e) => [e.id, e]));
  let n = 0;

  const featuresOf = (e: Entry): Feature[] => {
    switch (e.type) {
      case "ancestry":
      case "transformation":
        return e.features;
      case "community":
        return [e.feature];
      case "subclass":
        return [...e.foundation, ...e.specialization, ...e.mastery];
      case "class":
        return [e.hopeFeature, ...e.classFeatures];
      default:
        return [];
    }
  };
  const find = (id: string, name: string) => {
    const e = byId.get(id);
    if (!e) throw new Error(`modifiers.json: no entry ${id}`);
    const f = featuresOf(e).find((x) => x.name === name);
    if (!f) throw new Error(`modifiers.json: ${id} has no feature "${name}"`);
    return f;
  };

  for (const m of data.features) {
    find(m.id, m.feature).modifiers = withDefaults(m.modifiers);
    n++;
  }
  for (const c of data.choices) {
    const f = find(c.id, c.feature);
    f.choices = [...(f.choices ?? []), c.choice];
  }
  for (const r of data.resources) {
    const f = find(r.id, r.feature);
    f.resources = [...(f.resources ?? []), r.resource];
  }
  const card = (id: string) => {
    const e = byId.get(id);
    if (e?.type !== "domain-card") throw new Error(`modifiers.json: ${id} is not a domain card`);
    return e;
  };
  for (const c of data.cardChoices) {
    const e = card(c.id);
    const choice = Array.isArray(c.choice.options)
      ? { ...c.choice, options: (c.choice.options as unknown[]).map((o) => (typeof o === "object" && o && "modifiers" in o ? { ...o, modifiers: withDefaults((o as { modifiers: Modifier[] }).modifiers) } : o)) }
      : c.choice;
    e.choices = [...(e.choices ?? []), choice as typeof c.choice];
  }
  for (const id of data.vaultOnAcquire) card(id).vaultOnAcquire = true;
  for (const c of data.cards) {
    const e = byId.get(c.id);
    if (e?.type !== "domain-card") throw new Error(`modifiers.json: ${c.id} is not a domain card`);
    e.modifiers = withDefaults(c.modifiers);
    n++;
  }
  for (const e of entries) {
    if ((e.type === "weapon" || e.type === "armor") && e.feature) {
      const ms = equipmentModifiers(e.feature);
      if (ms.length) {
        e.feature.modifiers = ms;
        n++;
      }
    }
  }
  return n;
}
