import { describe, expect, it } from "vitest";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { type RawPack, validatePacks } from "../content/validate.ts";
import { stripTags, tokenize } from "../content/richtext.ts";
import type { Entry, EntryOf, EntryType } from "../content/schema/index.ts";

const raw = bundledPacks();
const { packs, issues } = validatePacks(raw);
const srd = packs.find((p) => p.meta.id === "srd")!;
const of = <K extends EntryType>(type: K) => srd.entries.filter((e): e is EntryOf<K> & Entry => e.type === type) as EntryOf<K>[];
const byName = <K extends EntryType>(type: K, name: string) => {
  const e = of(type).find((x) => x.name === name);
  if (!e) throw new Error(`${type} ${name} not found`);
  return e;
};

describe("bundled packs", () => {
  it("validate with no errors", () => {
    expect(issues.filter((i) => i.level === "error")).toEqual([]);
  });

  it("srd-frames is off by default and requires srd", () => {
    const frames = packs.find((p) => p.meta.id === "srd-frames")!;
    expect(frames.meta.defaultEnabled).toBe(false);
    expect(frames.meta.requires).toEqual(["srd"]);
    expect(srd.meta.defaultEnabled).toBe(true);
  });

  it("contain every entry the SRD lists", () => {
    const count = (t: EntryType) => of(t).length;
    expect(count("class")).toBe(13); // SRD p. 4 lists 13 classes
    expect(count("subclass")).toBe(26);
    expect(count("domain")).toBe(10);
    expect(count("domain-card")).toBe(210);
    expect(count("ancestry")).toBe(24); // p. 4 lists 24 ancestries
    expect(count("community")).toBe(15); // p. 4 lists 15 communities
    expect(count("transformation")).toBe(6);
    expect(count("beastform")).toBe(24);
    expect(count("weapon")).toBe(315);
    expect(count("armor")).toBe(69);
    expect(count("item")).toBe(120);
    expect(count("consumable")).toBe(120);
    expect(count("adversary")).toBe(258);
    expect(count("environment")).toBe(47);
    expect(count("condition")).toBe(3);
  });

  it("have 21 cards per domain, levels 1–10", () => {
    for (const d of of("domain")) {
      const cards = of("domain-card").filter((c) => c.domainId === d.id);
      expect(cards, d.name).toHaveLength(21);
      expect(new Set(cards.map((c) => c.level)), d.name).toEqual(new Set([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    }
  });

  it("roll tables cover 1–60 with no gaps", () => {
    for (const type of ["item", "consumable"] as const) {
      const tables = new Map<string, number[]>();
      for (const e of of(type)) tables.set(e.table, [...(tables.get(e.table) ?? []), e.roll]);
      for (const [name, rolls] of tables) expect(rolls.sort((a, b) => a - b), name).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
    }
  });

  it("every entry cites a source page", () => {
    for (const p of packs) for (const e of p.entries) expect(e.source.page, e.id).toBeGreaterThan(0);
  });
});

describe("spot checks against the PDF", () => {
  it("Assassin (p. 9)", () => {
    const c = byName("class", "Assassin");
    expect(c.startingEvasion).toBe(12);
    expect(c.startingHp).toBe(5);
    expect(c.domainIds).toEqual(["srd/domain/blade", "srd/domain/midnight"]);
    expect(c.hopeFeature.name).toBe("Deadly Determination");
    expect(c.classFeatures.map((f) => f.name)).toEqual(["Marked for Death", "Get In & Get Out"]);
    expect(c.subclassIds).toEqual(["srd/subclass/executioners-guild", "srd/subclass/poisoners-guild"]);
    expect(byName("subclass", "Executioners Guild").spellcastTrait).toBe("agility");
  });

  it("Warlock sphere list and Favor note (p. 26)", () => {
    const c = byName("class", "Warlock");
    expect(c.classFeatures.map((f) => f.name)).toEqual(["Patron’s Pact", "Favor"]);
    expect(stripTags(c.classFeatures[1].text)).toContain("The maximum Favor you can hold at one time is 6.");
    expect(c.lists?.[0].items).toHaveLength(24);
  });

  it("Broadsword (p. 56) and a wrapped name (Twisted Dagger)", () => {
    const w = byName("weapon", "Broadsword");
    expect(w).toMatchObject({ tier: 1, category: "primary", group: "physical", trait: "agility", range: "melee", damage: { dice: "d8", bonus: 0, type: "phy" }, burden: 1 });
    expect(w.feature?.name).toBe("Reliable");
    expect(byName("weapon", "Twisted Dagger")).toMatchObject({ trait: "knowledge", damage: { dice: "d8", bonus: 0 } });
    expect(byName("weapon", "Arcane-Frame Wheelchair").trait).toBe("spellcast");
  });

  it("Gambeson Armor (p. 72)", () => {
    expect(byName("armor", "Gambeson Armor")).toMatchObject({ tier: 1, baseThresholds: { major: 5, severe: 11 }, baseScore: 3 });
  });

  it("Dire Wolf (p. 100) and symbol-font digits", () => {
    const a = byName("adversary", "Dire Wolf");
    expect(a).toMatchObject({ tier: 1, role: "skulk", difficulty: 12, thresholds: { major: 5, severe: 9 }, hp: 4, stress: 3 });
    expect(a.attack).toEqual({ modifier: "+2", name: "Claws", range: "melee", damage: "1d6+2 phy" });
    expect(byName("adversary", "Swarm of Rats").hordePerHp).toBe(10);
  });

  it("odd stat lines are kept, not dropped", () => {
    expect(byName("adversary", "Octopus").thresholds).toEqual({ major: 3, severe: null });
    expect(byName("adversary", "Spellbound Armor").stress).toBeNull();
    expect(byName("adversary", "Outer Realms Abomination").attack.modifier).toBe("+2d4");
  });

  it("errata are applied", () => {
    expect(byName("domain-card", "Forest Sprites").level).toBe(8);
    expect(byName("beastform", "Mythic Hybrid").attack).toMatchObject({ range: "melee", trait: "strength" });
  });

  it("advancement slots per tier (owner-supplied)", () => {
    const p = of("progression")[0];
    const by = Object.fromEntries(p.advancements.map((a) => [a.id, a]));
    expect(by.traits.slotsByTier).toEqual({ 2: 3, 3: 3, 4: 3 });
    expect(by.subclass.slotsByTier).toEqual({ 3: 1, 4: 1 });
    expect(by.proficiency).toMatchObject({ cost: 2, slotsByTier: { 3: 2, 4: 2 } });
    expect(by.multiclass).toMatchObject({ cost: 2, minLevel: 5, slotsByTier: { 3: 2, 4: 2 } });
  });

  it("Ancestry features keep top/bottom order for mixed ancestry", () => {
    expect(byName("ancestry", "Goblin").features.map((f) => f.name)).toEqual(["Surefooted", "Danger Sense"]);
  });

  it("Book of Ava is a grimoire with named spells", () => {
    const c = byName("domain-card", "Book of Ava");
    expect(c.cardType).toBe("grimoire");
    expect(c.features?.map((f) => f.name)).toEqual(["Power Push", "Tava’s Armor", "Ice Spike"]);
  });

  it("rules terms are tagged", () => {
    const f = byName("class", "Assassin").classFeatures[0].text;
    expect(f).toContain("{{term:stress|Stress}}");
    expect(tokenize(f).some((t) => t.kind === "term" && t.slug === "fear")).toBe(true);
  });
});

describe("validator catches broken homebrew", () => {
  const hbMeta = { id: "hb-test", name: "Test brew", version: "1", kind: "homebrew", defaultEnabled: false, requires: ["srd"] };
  const hbSource = { kind: "homebrew", document: "Test brew" };
  const errorsFor = (entries: unknown[], meta: object = hbMeta) =>
    validatePacks([...raw, { meta, entries } as RawPack]).issues.filter((i) => i.level === "error" && i.pack === (meta as { id: string }).id);

  it("accepts a valid homebrew card that links into the SRD", () => {
    const card = {
      id: "hb-test/domain-card/sunburst", type: "domain-card", name: "Sunburst", pack: "hb-test", source: hbSource,
      domainId: "srd/domain/splendor", level: 1, cardType: "spell", recallCost: 1,
      text: "Mark a {{term:stress|Stress}} to heal an ally. See {{ref:srd/domain/splendor|Splendor}}.",
    };
    expect(errorsFor([card])).toEqual([]);
  });

  it("flags a subclass pointing at a class that doesn't exist", () => {
    const sub = {
      id: "hb-test/subclass/ghost", type: "subclass", name: "Ghost", pack: "hb-test", source: hbSource, classId: "hb-test/class/nope",
      text: "", spellcastTrait: null,
      foundation: [{ name: "A", text: "a" }], specialization: [{ name: "B", text: "b" }], mastery: [{ name: "C", text: "c" }],
    };
    expect(errorsFor([sub]).map((i) => i.message)).toContain("classId → hb-test/class/nope does not exist");
  });

  it("flags unknown terms, broken refs and malformed tags", () => {
    const card = {
      id: "hb-test/domain-card/x", type: "domain-card", name: "X", pack: "hb-test", source: hbSource,
      domainId: "srd/domain/arcana", level: 1, cardType: "spell", recallCost: 0,
      text: "{{term:mana|Mana}} {{ref:srd/class/nope}} {{term:stress",
    };
    const msgs = errorsFor([card]).map((i) => i.message);
    expect(msgs).toContain('text: unknown term "mana"');
    expect(msgs).toContain("text → srd/class/nope does not exist");
    expect(msgs.some((m) => m.includes("malformed tag"))).toBe(true);
  });

  it("flags duplicate ids, wrong pack prefixes and schema errors", () => {
    const base = { type: "condition", name: "Dazed", pack: "hb-test", source: hbSource, text: "x" };
    const msgs = errorsFor([
      { ...base, id: "hb-test/condition/dazed" },
      { ...base, id: "hb-test/condition/dazed" },
      { ...base, id: "srd/condition/stolen" },
      { ...base, id: "hb-test/condition/bad", text: 42 },
    ]).map((i) => i.message);
    expect(msgs).toContain("duplicate id");
    expect(msgs.some((m) => m.startsWith('id prefix "srd"'))).toBe(true);
    expect(msgs.some((m) => m.startsWith("text:"))).toBe(true);
  });

  it("flags links into packs the homebrew pack doesn't require", () => {
    const frameRule = packs.find((p) => p.meta.id === "srd-frames")!.entries[0].id;
    const card = {
      id: "hb-test/condition/y", type: "condition", name: "Y", pack: "hb-test", source: hbSource,
      text: `See {{ref:${frameRule}}}.`,
    };
    expect(errorsFor([card]).some((i) => i.message.includes("doesn't require"))).toBe(true);
  });

  it("rejects SRD-sourced entries in a homebrew pack", () => {
    const e = { id: "hb-test/condition/z", type: "condition", name: "Z", pack: "hb-test", source: { kind: "srd", document: "x", page: 1 }, text: "z" };
    expect(errorsFor([e]).some((i) => i.message.includes("source.kind"))).toBe(true);
  });
});

describe("rich text", () => {
  it("tokenizes terms and refs", () => {
    expect(tokenize("Mark a {{term:stress|Stress}} or see {{ref:srd/class/bard}}.")).toEqual([
      { kind: "text", text: "Mark a " },
      { kind: "term", slug: "stress", label: "Stress" },
      { kind: "text", text: " or see " },
      { kind: "ref", id: "srd/class/bard" },
      { kind: "text", text: "." },
    ]);
    expect(stripTags("Mark a {{term:stress|Stress}}.")).toBe("Mark a Stress.");
  });
});

describe("srd-frames equipment (pp. 191–192, 197, 201)", () => {
  const frames = packs.find((p) => p.meta.id === "srd-frames")!;
  const weapons = frames.entries.filter((e) => e.type === "weapon") as EntryOf<"weapon">[];
  const armor = frames.entries.filter((e) => e.type === "armor") as EntryOf<"armor">[];

  it("has the Everyday Hero, Western and Monster Hunting gear", () => {
    expect(weapons.length).toBe(76);
    expect(armor.length).toBe(16);
    expect(weapons.filter((w) => w.tags?.includes("everyday-hero")).every((w) => w.tier === 1)).toBe(true);
  });

  it("splits tier-scaled weapons and armor into one entry per tier", () => {
    const rev = weapons.filter((w) => w.name.startsWith("Revolver (Tier"));
    expect(rev.map((w) => `${w.tier}:${w.damage.dice}+${w.damage.bonus}`)).toEqual(["1:d8+1", "2:d8+4", "3:d8+7", "4:d8+10"]);
    const coat = armor.filter((a) => a.name.startsWith("Leather Longcoat"));
    expect(coat.map((a) => `${a.tier}:${a.baseThresholds.major}/${a.baseThresholds.severe}/${a.baseScore}`)).toEqual(["1:5/12/3", "2:8/18/4", "3:10/25/5", "4:12/34/6"]);
  });

  it("reads unbolded armor features and their modifiers", () => {
    const q = armor.find((a) => a.name === "Quilted Clothing")!;
    expect(q.feature).toMatchObject({ name: "Flexible", modifiers: [{ target: "evasion", value: 1, when: "equipped" }] });
  });
});
