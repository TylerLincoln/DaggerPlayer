import { describe, expect, it } from "vitest";
import type { Entry, PackMeta, Trait } from "../content/schema/index.ts";
import { bundledPacks } from "../scripts/validate-packs.ts";
import { Registry } from "../src/content/registry.ts";
import { finishBuild, validateBuild } from "../src/rules/builder.ts";
import { type CharacterDoc, type LevelUp, newCharacter } from "../src/rules/character.ts";
import { derive } from "../src/rules/derive.ts";
import { scriptedRng } from "../src/rules/dice.ts";
import { parseDamage, rollDamageDice } from "../src/rules/duality.ts";
import { type Advancement, applyLevelUp, emptyLevelUp, markedTraits, optionStatus, ownedCards, undoLastLevelUp, validateLevelUp } from "../src/rules/levelup.ts";
import { dropBeastform, frequencyOf, fromVault, markHp, newSession, resourceValue, rollPool, takeRest, toggleUsed, transform, useKey } from "../src/rules/sheet.ts";

const packs = bundledPacks();
const reg = new Registry(packs.flatMap((p) => p.entries as Entry[]), packs.map((p) => p.meta as PackMeta));
const TRAITS3 = { agility: 2, strength: 1, finesse: 1, instinct: 0, presence: 0, knowledge: -1 } as Record<Trait, number>;

function hero(classId: string, subclassId: string, cards: [string, string], over: (c: CharacterDoc) => void = () => {}): CharacterDoc {
  const c = newCharacter();
  const cls = reg.get(classId, "class")!;
  c.identity.name = "Test";
  Object.assign(c.build, {
    classId, subclassId, ancestry: { kind: "single", id: "srd/ancestry/elf" }, communityId: "srd/community/highborne", traits: { ...TRAITS3 },
    gear: { primaryId: "srd/weapon/broadsword", secondaryId: null, armorId: "srd/armor/leather-armor", potion: "health", classItem: cls.classItems[0], spellItem: "", extraItems: "" },
    domainCardIds: cards[0] ? cards : reg.all("domain-card").filter((x) => cls.domainIds.includes(x.domainId) && x.level === 1).slice(0, 2).map((x) => x.id),
  });
  c.build.experiences[0].name = "First";
  c.build.experiences[1].name = "Second";
  over(c);
  return finishBuild(c, reg);
}

/** Level up with legal filler advancements (picked from what's available) and the first legal card. */
function levelTo(c: CharacterDoc, level: number): CharacterDoc {
  while (1 + c.levelUps.length < level) {
    const lu = emptyLevelUp(c);
    if (lu.newExperience) lu.newExperience.name = `Lesson ${lu.level}`;
    const picks: Advancement[] = [];
    for (const id of ["hp", "stress", "evasion", "experiences", "traits"]) {
      if (picks.length === 2) break;
      const st = optionStatus(c, reg, lu.level, picks).find((o) => o.id === id);
      if (!st?.available) continue;
      if (id === "experiences") picks.push({ optionId: id, experienceIds: c.build.experiences.map((x) => x.id) });
      else if (id === "traits") {
        const marked = markedTraits(c.levelUps, lu.level);
        picks.push({ optionId: id, traits: (["agility", "strength", "finesse", "instinct", "presence", "knowledge"] as Trait[]).filter((t) => !marked.has(t)).slice(0, 2) });
      } else picks.push({ optionId: id });
    }
    lu.advancements = picks;
    const domains = derive(c, reg).domainIds;
    lu.domainCardId = reg.all("domain-card").find((x) => domains.includes(x.domainId) && x.level <= lu.level && !x.choices && !ownedCards(c).includes(x.id))!.id;
    c = applyLevelUp(c, lu, reg);
  }
  return c;
}

describe("cards with choices", () => {
  const guardian = () => hero("srd/class/guardian", "srd/subclass/stalwart", ["", ""]);

  it("Vitality: choose two benefits, applied permanently from the vault", () => {
    const c4 = levelTo(guardian(), 4);
    const base = derive(c4, reg);
    const lu = { ...emptyLevelUp(c4), advancements: [{ optionId: "hp" }, { optionId: "stress" }] as Advancement[], domainCardId: "srd/domain-card/vitality" };
    lu.newExperience!.name = "Lesson 5";
    expect(validateLevelUp(c4, lu, reg)).toContain("Vitality: Permanently gain two of these benefits.");
    expect(validateLevelUp(c4, { ...lu, choices: { vitality: "hp" } }, reg)).toContain("Vitality: choose 2.");
    const c5 = applyLevelUp(c4, { ...lu, choices: { vitality: "hp,thresholds" } }, reg);
    expect(c5.state.vault).toContain("srd/domain-card/vitality");
    expect(c5.state.loadout).not.toContain("srd/domain-card/vitality");
    const d = derive(c5, reg);
    expect(d.hpMax.total).toBe(base.hpMax.total + 1 + 1); // advancement + Vitality
    expect(d.thresholds.major.total).toBe(base.thresholds.major.total + 1 + 2); // level + Vitality
    expect(() => fromVault(c5, reg, "srd/domain-card/vitality", { resting: true })).toThrow(/permanently/);
    expect(undoLastLevelUp(c5).build.featureChoices.vitality).toBeUndefined();
  });

  it("Master of the Craft: +2 to two Experiences or +3 to one", () => {
    const bard = levelTo(hero("srd/class/bard", "srd/subclass/troubadour", ["", ""]), 8);
    const [a, b] = bard.build.experiences.map((x) => x.id);
    const lu = { ...emptyLevelUp(bard), advancements: [{ optionId: "hp" }, { optionId: "stress" }] as Advancement[], domainCardId: "srd/domain-card/master-of-the-craft" };
    expect(validateLevelUp(bard, { ...lu, choices: { "master-of-the-craft": `two:${a}` } }, reg).some((e) => e.includes("two Experiences"))).toBe(true);
    const nine = applyLevelUp(bard, { ...lu, choices: { "master-of-the-craft": `one:${b}` } }, reg);
    const x = derive(nine, reg).experiences.find((e) => e.id === b)!;
    expect(x.bonus.parts.some((p) => p.source === "Master of the Craft" && p.value === 3)).toBe(true);
  });
});

describe("Brawler's Strike", () => {
  it("+1 Evasion only with no active weapons; d8+d6 both scale with Proficiency", () => {
    const b = hero("srd/class/brawler", "srd/subclass/juggernaut", ["", ""], (c) => {
      c.build.gear.primaryId = null;
      c.build.featureChoices["brawler-strike-trait"] = "strength";
    });
    expect(derive(b, reg).evasion.parts.some((p) => p.source === "Brawler: I Am the Weapon" && p.value === 1)).toBe(true);
    const armed = structuredClone(b);
    armed.state.activePrimaryId = "srd/weapon/broadsword";
    expect(derive(armed, reg).evasion.total).toBe(derive(b, reg).evasion.total - 1);
    const r = rollDamageDice([{ count: 2, die: 8 }, { count: 2, die: 6 }], 0, true, scriptedRng([{ value: 3, sides: 8 }, { value: 5, sides: 8 }, { value: 1, sides: 6 }, { value: 6, sides: 6 }]));
    expect([r.total, r.formula]).toEqual([3 + 5 + 1 + 6 + 28, "2d8+2d6+28"]);
  });
});

describe("Beastform", () => {
  const druid = () => hero("srd/class/druid", "srd/subclass/warden-of-renewal", ["srd/domain-card/gifted-tracker", "srd/domain-card/rune-ward"]);

  it("marks a Stress, adds the form's Evasion and trait bonus, and drops on the last HP", () => {
    const c = druid();
    const before = derive(c, reg);
    const r = transform(c, reg, "srd/beastform/agile-scout");
    expect(r.doc.state.stressMarked).toBe(1);
    const d = derive(r.doc, reg);
    expect(d.evasion.total).toBe(before.evasion.total + 2);
    expect(d.traits.agility.total).toBe(before.traits.agility.total + 1);
    const dropped = markHp(r.doc, d, d.hpMax.total);
    expect(dropped.doc.state.beastformId).toBeNull();
    expect(dropped.notes.join()).toMatch(/drop out of your Beastform/);
    expect(derive(dropBeastform(r.doc), reg).evasion.total).toBe(before.evasion.total);
  });

  it("Evolution spends 3 Hope instead and raises a trait; forms above your tier are refused", () => {
    const c = druid();
    c.state.hope = 3;
    const r = transform(c, reg, "srd/beastform/pack-predator", { evolution: "instinct" });
    expect([r.doc.state.hope, r.doc.state.stressMarked]).toEqual([0, 0]);
    expect(derive(r.doc, reg).traits.instinct.parts.some((p) => p.source === "Evolution")).toBe(true);
    expect(() => transform(c, reg, "srd/beastform/armored-sentry")).toThrow(/Tier 2/);
    expect(() => transform(hero("srd/class/ranger", "srd/subclass/wayfinder", ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"]), reg, "srd/beastform/agile-scout")).toThrow(/Beastform feature/);
  });
});

describe("limited uses and resources", () => {
  it("reads frequencies from feature text", () => {
    expect(frequencyOf("Once per long rest, you can…")).toBe("long-rest");
    expect(frequencyOf("Once per {{term:short-rest|rest}}, describe…")).toBe("rest");
    expect(frequencyOf("Once per session, describe how you rally")).toBe("session");
    expect(frequencyOf("Spend a Hope to…")).toBeNull();
  });

  it("rests and new sessions clear the right marks", () => {
    let c = hero("srd/class/bard", "srd/subclass/troubadour", ["srd/domain-card/deft-deceiver", "srd/domain-card/enrapture"].map(() => "") as [string, string], (x) => {
      x.build.domainCardIds = reg.all("domain-card").filter((k) => ["srd/domain/grace", "srd/domain/codex"].includes(k.domainId) && k.level === 1).slice(0, 2).map((k) => k.id);
    });
    for (const [f, n] of [["rest", "A"], ["long-rest", "B"], ["session", "C"]] as const) c = toggleUsed(c, useKey(f, n));
    const short = takeRest(c, reg, "short", []).doc;
    expect(Object.keys(short.state.resources).sort()).toEqual(["use:long-rest:B", "use:session:C"]);
    const long = takeRest(c, reg, "long", []).doc;
    expect(Object.keys(long.state.resources)).toEqual(["use:session:C"]);
    expect(Object.keys(newSession(c, derive(c, reg)).state.resources).sort()).toEqual(["use:long-rest:B", "use:rest:A"]);
  });

  it("Warlock Favor starts at 3 (max 6); Seraph Prayer Dice roll one d4 per Spellcast trait point", () => {
    const w = hero("srd/class/warlock", "srd/subclass/pact-of-the-endless", ["srd/domain-card/x", "srd/domain-card/y"], (x) => {
      x.build.domainCardIds = reg.all("domain-card").filter((k) => ["srd/domain/dread", "srd/domain/grace"].includes(k.domainId) && k.level === 1).slice(0, 2).map((k) => k.id);
      x.build.featureChoices = { "patron-name": "The Hollow Queen", "patron-sphere": "Secrets" };
    });
    const favor = derive(w, reg).resources.find((r) => r.id === "favor")!;
    expect([favor.max, resourceValue(w, favor)]).toEqual([6, 3]);
    expect(derive(w, reg).resources.find((r) => r.id === "patron-die")!.die).toBe("d6");

    const s = hero("srd/class/seraph", "srd/subclass/divine-wielder", ["", ""], (x) => {
      x.build.domainCardIds = reg.all("domain-card").filter((k) => ["srd/domain/splendor", "srd/domain/valor"].includes(k.domainId) && k.level === 1).slice(0, 2).map((k) => k.id);
      x.build.traits = { agility: 0, strength: 2, finesse: 1, instinct: 1, presence: 0, knowledge: -1 };
    });
    const pool = derive(s, reg).resources.find((r) => r.id === "prayer-dice")!;
    expect(pool.max).toBe(2); // Divine Wielder casts with Strength +2
    const rolled = rollPool(s, pool.id, pool.max, pool.die!, scriptedRng([{ value: 4, sides: 4 }, { value: 1, sides: 4 }]));
    expect(resourceValue(rolled, pool)).toEqual([4, 1]);
    expect(resourceValue(newSession(rolled, derive(rolled, reg)), pool)).toEqual([]);
  });

  it("builder asks for every feature choice (Warlock patron, Wizard number)", () => {
    const c = newCharacter();
    Object.assign(c.build, { classId: "srd/class/wizard", subclassId: "srd/subclass/school-of-war" });
    expect(validateBuild(c, reg).some((i) => i.message.startsWith("Strange Patterns:"))).toBe(true);
  });

  it("reads beastform damage", () => {
    expect(parseDamage("d8+2")).toEqual({ die: 8, bonus: 2 });
    expect(parseDamage("d12+10")).toEqual({ die: 12, bonus: 10 });
  });
});

describe("Ranger companion (Beastbound)", () => {
  const ranger = () =>
    hero("srd/class/ranger", "srd/subclass/beastbound", ["srd/domain-card/gifted-tracker", "srd/domain-card/vicious-entangle"], (c) => {
      c.state.companion = { name: "Ash", kind: "Wolf", experiences: [{ id: "x1", name: "Scout", bonus: 2 }, { id: "x2", name: "Loyal", bonus: 2 }], attack: "Bite", damageType: "phy", baseStress: null, stressMarked: 0 };
    });

  it("starts at Evasion 10, a d6 Melee attack and 3 Stress (companion sheet default)", () => {
    const d = derive(ranger(), reg).companion!;
    expect([d.evasion.total, d.die, d.range, d.stressMax?.total]).toEqual([10, "d6", "Melee", 3]);
    expect(validateBuild(ranger(), reg).some((i) => /starting Stress/.test(i.message))).toBe(false);
  });

  it("level-ups need a companion option, each option once; options change the companion", () => {
    let c = ranger();
    c.state.companion!.baseStress = 3;
    const lu = { ...emptyLevelUp(c), advancements: [{ optionId: "hp" }, { optionId: "stress" }] as Advancement[], domainCardId: "srd/domain-card/natures-tongue" };
    lu.newExperience!.name = "Lesson";
    expect(validateLevelUp(c, lu, reg)).toContain("Choose a level-up option for your companion.");
    expect(validateLevelUp(c, { ...lu, companionOption: "aware" }, reg)).toContain("Your companion also gains a new Experience at +2: name it.");
    c = applyLevelUp(c, { ...lu, companionOption: "aware", companionExperience: { id: "x3", name: "Tracker", bonus: 2 } }, reg);
    const lu3 = { ...emptyLevelUp(c), advancements: [{ optionId: "hp" }, { optionId: "stress" }] as Advancement[], domainCardId: "srd/domain-card/conjure-swarm" };
    expect(validateLevelUp(c, { ...lu3, companionOption: "aware" }, reg)).toContain("Your companion already has that option.");
    c = applyLevelUp(c, { ...lu3, companionOption: "vicious:die" }, reg);
    const d = derive(c, reg).companion!;
    expect([d.evasion.total, d.die, d.stressMax?.total, d.experiences.length]).toEqual([12, "d8", 3, 3]);
  });
});
