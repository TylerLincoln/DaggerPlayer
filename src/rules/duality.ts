// Action rolls, damage rolls and taking damage (SRD 2.0 pp. 47–50). Pure; dice come from an injectable RNG.
import type { CharacterDoc } from "./character.ts";
import type { Derived } from "./derive.ts";
import { cryptoRng, type Rng, rollDie } from "./dice.ts";
import { clearStress, gainHope, markArmor, markHp, type Result, RuleError } from "./sheet.ts";

export interface Mod {
  label: string;
  value: number;
}

export interface DualityInput {
  /** trait and other flat modifiers (Experiences, Group Action, feature bonuses) */
  modifiers: Mod[];
  /** number of sources granting advantage / disadvantage; they cancel one for one (p. 49) */
  advantage: number;
  disadvantage: number;
  /** advantage dice rolled by allies using Help an Ally; only the highest advantage die counts (p. 49) */
  helpDice?: number[];
  /** reaction rolls don't generate Hope or Fear (p. 48) */
  reaction?: boolean;
  difficulty?: number | null;
}

export type DualityKind = "crit" | "hope" | "fear";

export interface DualityResult {
  hope: number;
  fear: number;
  /** the advantage (+) or disadvantage (−) die actually applied, if any */
  extraDie: { kind: "advantage" | "disadvantage"; value: number; from: "you" | "ally" } | null;
  /** every advantage die rolled (yours and allies'), for display */
  advantageDice: number[];
  modifiers: Mod[];
  total: number;
  kind: DualityKind;
  reaction: boolean;
  difficulty: number | null;
  /** null when no Difficulty was given */
  success: boolean | null;
}

export function rollDuality(input: DualityInput, rng: Rng = cryptoRng): DualityResult {
  const hope = rollDie(12, rng);
  const fear = rollDie(12, rng);
  const help = input.helpDice ?? [];
  // allies helping count as advantage sources; they and disadvantage cancel one for one
  const net = input.advantage + help.length - input.disadvantage;
  let extraDie: DualityResult["extraDie"] = null;
  const advantageDice: number[] = [];
  if (net > 0) {
    const own = input.advantage > 0 ? rollDie(6, rng) : null;
    if (own !== null) advantageDice.push(own);
    advantageDice.push(...help);
    const best = Math.max(...advantageDice);
    extraDie = { kind: "advantage", value: best, from: own !== null && own === best ? "you" : "ally" };
  } else if (net < 0) {
    extraDie = { kind: "disadvantage", value: rollDie(6, rng), from: "you" };
  }
  const mods = input.modifiers.reduce((s, m) => s + m.value, 0);
  const total = hope + fear + mods + (extraDie ? (extraDie.kind === "advantage" ? extraDie.value : -extraDie.value) : 0);
  const kind: DualityKind = hope === fear ? "crit" : hope > fear ? "hope" : "fear";
  const difficulty = input.difficulty ?? null;
  // a Critical Success always succeeds (p. 47)
  const success = kind === "crit" ? true : difficulty === null ? null : total >= difficulty;
  return { hope, fear, extraDie, advantageDice, modifiers: input.modifiers, total, kind, reaction: !!input.reaction, difficulty, success };
}

/** "Success with Hope", "17 with Fear", "Critical Success!" … */
export function describeDuality(r: DualityResult): string {
  if (r.kind === "crit") return "Critical Success!";
  const w = r.kind === "hope" ? "Hope" : "Fear";
  if (r.success === null) return `${r.total} with ${w}`;
  return `${r.success ? "Success" : "Failure"} with ${w}`;
}

/** What the result means at the table, per p. 47–48. */
export function consequences(r: DualityResult): string[] {
  if (r.reaction) return r.kind === "crit" ? ["Critical success on a reaction: ignore any effects that would have impacted you on a success."] : ["Reaction rolls don't generate Hope or Fear."];
  if (r.kind === "crit") return ["You automatically succeed with a bonus, gain a Hope and clear a Stress.", "On an attack roll, deal critical damage."];
  if (r.kind === "hope") return r.success === false ? ["You fail with a minor consequence and gain a Hope; the spotlight swings to the GM."] : ["You gain a Hope.", ...(r.success ? ["The spotlight stays with the players."] : [])];
  return r.success === false ? ["You fail with a major consequence; the GM gains a Fear and takes the spotlight."] : [r.success ? "You succeed with a cost or complication; the GM gains a Fear and takes the spotlight." : "The GM gains a Fear."];
}

/** Apply a roll's results to the sheet: Hope for rolls with Hope; Hope + clear a Stress on a crit; nothing on reactions. */
export function applyDuality(c: CharacterDoc, d: Derived, r: DualityResult): Result {
  if (r.reaction) return { doc: c, notes: [] };
  if (r.kind === "fear") return { doc: c, notes: ["The GM gains a Fear."] };
  let doc = gainHope(c, d, 1);
  const notes = [doc.state.hope > c.state.hope ? "Gained a Hope." : "You're at your Hope maximum."];
  if (r.kind === "crit") {
    if (doc.state.stressMarked > 0) notes.push("Cleared a Stress.");
    doc = clearStress(doc, 1);
  }
  return { doc, notes };
}

/** Spend 1 Hope per Experience used (p. 49). */
export function spendForExperiences(c: CharacterDoc, count: number): CharacterDoc {
  if (count === 0) return c;
  if (c.state.hope < count) throw new RuleError(`Using ${count} Experience${count > 1 ? "s" : ""} costs ${count} Hope; you have ${c.state.hope}.`);
  const doc = structuredClone(c);
  doc.state.hope -= count;
  return doc;
}

// ---------- damage rolls (p. 50) ----------

export interface DamageRoll {
  count: number;
  die: number;
  bonus: number;
  dice: number[];
  crit: boolean;
  /** max of the dice, added on a critical success */
  critBonus: number;
  total: number;
  formula: string;
}

/** Damage with several dice sizes, each rolled `count` times (Brawler's Strike: Proficiency × (d8 + d6)). */
export function rollDamageDice(groups: { count: number; die: number }[], bonus: number, crit = false, rng: Rng = cryptoRng): DamageRoll {
  const dice: number[] = [];
  let critBonus = 0;
  for (const g of groups) for (let i = 0; i < Math.max(0, g.count); i++) {
    dice.push(rollDie(g.die, rng));
    if (crit) critBonus += g.die;
  }
  const formula = groups.map((g) => `${g.count}d${g.die}`).join("+") + (bonus ? `${bonus > 0 ? "+" : "−"}${Math.abs(bonus)}` : "") + (crit ? `+${critBonus}` : "");
  return { count: dice.length, die: groups[0]?.die ?? 0, bonus, dice, crit, critBonus, total: dice.reduce((a, b) => a + b, 0) + bonus + critBonus, formula };
}

/** Parse "d8+2" / "d12+10" / "1d6+2" into a die and bonus. */
export function parseDamage(expr: string): { die: number; bonus: number } {
  const m = expr.replace(/\s+/g, "").match(/^\d*d(\d+)([+-]\d+)?$/);
  if (!m) throw new Error(`can't read damage "${expr}"`);
  return { die: Number(m[1]), bonus: Number(m[2] ?? 0) };
}

export function rollDamage(count: number, die: number, bonus: number, crit = false, rng: Rng = cryptoRng): DamageRoll {
  const n = Math.max(0, count);
  const dice = Array.from({ length: n }, () => rollDie(die, rng));
  const critBonus = crit ? n * die : 0;
  const formula = `${n}d${die}${bonus ? `${bonus > 0 ? "+" : "−"}${Math.abs(bonus)}` : ""}${crit ? `+${critBonus}` : ""}`;
  return { count: n, die, bonus, dice, crit, critBonus, total: dice.reduce((a, b) => a + b, 0) + bonus + critBonus, formula };
}

// ---------- taking damage (p. 50) ----------

export interface DamageOptions {
  /** mark one Armor Slot to drop the severity one step */
  useArmor: boolean;
  /** resistance to this damage type halves it, rounding up (p. 53), before armor */
  resistant?: boolean;
  immune?: boolean;
  /** direct damage can't be reduced by Armor Slots */
  direct?: boolean;
  /** optional Massive Damage rule: twice the Severe threshold marks 4 HP */
  massive?: boolean;
}

export type Severity = 0 | 1 | 2 | 3 | 4;
export const SEVERITY_LABEL = ["None", "Minor", "Major", "Severe", "Massive"] as const;

export function severityOf(amount: number, major: number, severe: number, massive = false): Severity {
  if (amount <= 0) return 0;
  if (massive && amount >= 2 * severe) return 4;
  if (amount >= severe) return 3;
  if (amount >= major) return 2;
  return 1;
}

export interface DamagePlan {
  incoming: number;
  final: number;
  severity: Severity;
  armorUsed: boolean;
  hp: number;
  steps: string[];
}

export function planDamage(amount: number, d: Derived, c: CharacterDoc, o: DamageOptions): DamagePlan {
  const steps: string[] = [];
  let final = Math.max(0, Math.floor(amount));
  if (o.immune) {
    steps.push("Immune: no damage.");
    return { incoming: amount, final: 0, severity: 0, armorUsed: false, hp: 0, steps };
  }
  if (o.resistant) {
    const halved = Math.ceil(final / 2);
    steps.push(`Resistance halves ${final} to ${halved}.`);
    final = halved;
  }
  let severity = severityOf(final, d.thresholds.major.total, d.thresholds.severe.total, o.massive);
  steps.push(`${final} damage is ${SEVERITY_LABEL[severity]} (thresholds ${d.thresholds.major.total}/${d.thresholds.severe.total}).`);
  let armorUsed = false;
  if (o.useArmor && severity > 0) {
    if (o.direct) steps.push("Direct damage: Armor Slots can't reduce it.");
    else if (d.armorScore.total === 0 || c.state.armorMarked >= d.armorScore.total) steps.push("No unmarked Armor Slot to mark.");
    else {
      severity = (severity - 1) as Severity;
      armorUsed = true;
      steps.push(`Marked an Armor Slot: reduced to ${SEVERITY_LABEL[severity]}.`);
    }
  }
  return { incoming: amount, final, severity, armorUsed, hp: severity, steps };
}

export function takeDamage(c: CharacterDoc, d: Derived, amount: number, o: DamageOptions): Result & { plan: DamagePlan } {
  const plan = planDamage(amount, d, c, o);
  let doc = c;
  if (plan.armorUsed) doc = markArmor(doc, d, 1);
  const r = plan.hp > 0 ? markHp(doc, d, plan.hp) : { doc, notes: [] };
  return { doc: r.doc, notes: [...plan.steps, plan.hp ? `Marked ${plan.hp} HP.` : "No HP marked.", ...r.notes], plan };
}
