import { useState } from "react";
import { TRAITS, type Trait } from "../../../content/schema/index.ts";
import type { Registry } from "../../content/registry.ts";
import { logRoll, startSession, useRollLog } from "../../data/rolls.ts";
import { useSettings } from "../../data/settings.ts";
import type { CharacterDoc } from "../../rules/character.ts";
import type { Derived } from "../../rules/derive.ts";
import { applyDuality, consequences, describeDuality, type DamageRoll, type DualityResult, type Mod, planDamage, rollDamage, rollDuality, SEVERITY_LABEL, spendForExperiences, takeDamage } from "../../rules/duality.ts";
import { clearArmor, clearHp, clearStress, markArmor, markHp, markStress, type Result } from "../../rules/sheet.ts";
import { formatMod } from "../../rules/traits.ts";
import { Drawer } from "../../ui/Drawer.tsx";
import { TermLink } from "../../ui/RichText.tsx";

export interface PlayCtx {
  c: CharacterDoc;
  d: Derived;
  reg: Registry;
  act: (fn: (c: CharacterDoc) => CharacterDoc | Result) => void;
  remote: { userId: string | null; savedOnServer: boolean };
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

// ---------- trackers ----------

type TrackKind = "hp" | "stress" | "hope" | "armor";
const TRACKS: Record<TrackKind, { label: string; term: string; unit: string }> = {
  hp: { label: "Hit Points", term: "hit-points", unit: "Hit Point" },
  stress: { label: "Stress", term: "stress", unit: "Stress" },
  hope: { label: "Hope", term: "hope", unit: "Hope" },
  armor: { label: "Armor Slots", term: "armor-slot", unit: "Armor Slot" },
};

/** Change a track to `target` marked boxes through the rules functions (so overflow/Vulnerable rules apply). */
function setTrack(kind: TrackKind, target: number, c: CharacterDoc, d: Derived): CharacterDoc | Result {
  const cur = kind === "hp" ? c.state.hpMarked : kind === "stress" ? c.state.stressMarked : kind === "hope" ? c.state.hope : c.state.armorMarked;
  const delta = target - cur;
  if (delta === 0) return c;
  switch (kind) {
    case "hp": return delta > 0 ? markHp(c, d, delta) : clearHp(c, -delta);
    case "stress": return delta > 0 ? markStress(c, d, delta) : clearStress(c, -delta);
    case "armor": return delta > 0 ? markArmor(c, d, delta) : clearArmor(c, -delta);
    case "hope": {
      const doc = structuredClone(c);
      doc.state.hope = Math.max(0, Math.min(d.hopeMax, target));
      return doc;
    }
  }
}

export function TapTrack({ kind, c, d, act }: PlayCtx & { kind: TrackKind }) {
  const t = TRACKS[kind];
  const marked = kind === "hp" ? c.state.hpMarked : kind === "stress" ? c.state.stressMarked : kind === "hope" ? c.state.hope : c.state.armorMarked;
  const max = kind === "hp" ? d.hpMax.total : kind === "stress" ? d.stressMax.total : kind === "hope" ? d.hopeMax : d.armorScore.total;
  const verb = kind === "hope" ? "" : " marked";
  const go = (target: number) => act((x) => setTrack(kind, Math.max(0, Math.min(max, target)), x, d));
  return (
    <div className="track" role="group" aria-label={`${t.label}: ${marked} of ${max}${verb}`}>
      <div className="track-label">
        <TermLink slug={t.term} label={t.label} /> <span className="hint" aria-hidden="true">{marked} / {max}</span>
      </div>
      <div className="track-row">
        <button type="button" className="step" aria-label={`${kind === "hope" ? "Spend" : "Clear"} one ${t.unit}`} disabled={marked === 0} onClick={() => go(marked - 1)}>−</button>
        <div className="boxes">
          {Array.from({ length: max }, (_, i) => (
            <button key={i} type="button" className={`box ${kind}${i < marked ? " on" : ""}`} aria-pressed={i < marked}
              aria-label={`${t.unit} ${i + 1} of ${max}`} onClick={() => go(i + 1 === marked ? i : i + 1)} />
          ))}
          {max === 0 && <span className="hint">None{kind === "armor" ? " (Armor Score 0)" : ""}</span>}
        </div>
        <button type="button" className="step" aria-label={`${kind === "hope" ? "Gain" : "Mark"} one ${t.unit}`} disabled={marked >= max} onClick={() => go(marked + 1)}>+</button>
      </div>
    </div>
  );
}

// ---------- dice roller ----------

export interface RollPreset {
  trait?: Trait;
  weaponId?: string;
  experienceIds?: string[];
  reaction?: boolean;
}

function traitValue(d: Derived, t: Trait) {
  return d.traits[t].total;
}

export function Roller({ preset, onClose, ...ctx }: PlayCtx & { preset: RollPreset | null; onClose: () => void }) {
  const { c, d, reg, act, remote } = ctx;
  const settings = useSettings();
  const weapon = reg.get(preset?.weaponId, "weapon");
  const defaultTrait: Trait | "" = preset?.trait ?? (weapon ? (weapon.trait === "spellcast" ? d.spellcastTraits[0] ?? "" : weapon.trait) : "");
  const [trait, setTrait] = useState<Trait | "">(defaultTrait);
  const [xps, setXps] = useState<string[]>(preset?.experienceIds ?? []);
  const [adv, setAdv] = useState(0);
  const [dis, setDis] = useState(0);
  const [help, setHelp] = useState("");
  const [other, setOther] = useState(0);
  const [difficulty, setDifficulty] = useState("");
  const [reaction, setReaction] = useState(!!preset?.reaction);
  const [result, setResult] = useState<DualityResult | null>(null);
  const [damage, setDamage] = useState<DamageRoll | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string[]>([]);

  const roll = () => {
    setError(null);
    setDamage(null);
    const helpDice = help.split(/[\s,]+/).map(Number).filter((n) => n >= 1 && n <= 6);
    const mods: Mod[] = [
      ...(trait ? [{ label: cap(trait), value: traitValue(d, trait) }] : []),
      ...xps.map((id) => { const x = d.experiences.find((e) => e.id === id)!; return { label: x.name, value: x.bonus.total }; }),
      ...(other ? [{ label: "Other", value: other }] : []),
    ];
    // Experiences cost a Hope each and are declared before the roll (p. 47, 49)
    if (xps.length && c.state.hope < xps.length) return setError(`Using ${xps.length} Experience${xps.length > 1 ? "s" : ""} costs ${xps.length} Hope; you have ${c.state.hope}.`);
    if (xps.length) act((x) => spendForExperiences(x, xps.length));
    const r = rollDuality({ modifiers: mods, advantage: adv, disadvantage: dis, helpDice, reaction, difficulty: difficulty ? Number(difficulty) : null });
    let notes: string[] = consequences(r);
    if (settings.dice.autoApply) {
      act((x) => {
        const res = applyDuality(x, d, r);
        notes = [...res.notes, ...notes.filter((n) => !/gain a Hope|clear a Stress/.test(n) || r.reaction)];
        return res;
      });
    }
    if (xps.length) notes.unshift(`Spent ${xps.length} Hope on Experience${xps.length > 1 ? "s" : ""}.`);
    setResult(r);
    setApplied(notes);
    const label = [weapon ? `${weapon.name} attack` : reaction ? "Reaction" : "Action", trait && cap(trait), ...xps.map((id) => d.experiences.find((e) => e.id === id)?.name)].filter(Boolean).join(" · ");
    logRoll(
      { characterId: c.id, kind: reaction ? "reaction" : "action", label, summary: describeDuality(r), detail: diceLine(r), applied: settings.dice.autoApply ? notes : [] },
      remote,
    );
  };

  const rollDmg = () => {
    if (!weapon) return;
    const crit = result?.kind === "crit" && !result.reaction;
    const r = rollDamage(d.proficiency.total, Number(weapon.damage.dice.slice(1)), weapon.damage.bonus, crit);
    setDamage(r);
    logRoll({ characterId: c.id, kind: "damage", label: `${weapon.name} damage${crit ? " (critical)" : ""}`, summary: `${r.total} ${weapon.damage.type}`, detail: `${r.formula}: [${r.dice.join(", ")}]${r.bonus ? ` ${formatMod(r.bonus)}` : ""}${r.crit ? ` +${r.critBonus} crit` : ""}`, applied: [] }, remote);
  };

  const traits = TRAITS;
  return (
    <Drawer open={!!preset} onClose={onClose} title={weapon ? `Attack with ${weapon.name}` : "Roll the Duality Dice"}
      footer={<button type="button" className="primary" onClick={roll}>Roll{xps.length ? ` (spend ${xps.length} Hope)` : ""}</button>}>
      <div className="roller">
        <div className="field">
          <label htmlFor="r-trait">Trait</label>
          <select id="r-trait" value={trait} onChange={(e) => setTrait(e.target.value as Trait | "")}>
            <option value="">None</option>
            {traits.map((t) => <option key={t} value={t}>{cap(t)} {formatMod(traitValue(d, t))}{d.spellcastTraits.includes(t) ? " (Spellcast)" : ""}</option>)}
          </select>
        </div>
        {d.experiences.length > 0 && (
          <fieldset>
            <legend><TermLink slug="experience" label="Experiences" /> (1 Hope each; you have {c.state.hope})</legend>
            {d.experiences.map((x) => {
              const on = xps.includes(x.id);
              return (
                <label key={x.id} className="radio">
                  <input type="checkbox" checked={on} disabled={!on && xps.length >= c.state.hope} onChange={() => setXps(on ? xps.filter((y) => y !== x.id) : [...xps, x.id])} />
                  {x.name} {formatMod(x.bonus.total)}
                </label>
              );
            })}
          </fieldset>
        )}
        <div className="steppers">
          <Stepper id="r-adv" label="Advantage sources" value={adv} set={setAdv} />
          <Stepper id="r-dis" label="Disadvantage sources" value={dis} set={setDis} />
        </div>
        <div className="field">
          <label htmlFor="r-help">Help an Ally dice (allies' d6 results, comma separated)</label>
          <input id="r-help" inputMode="numeric" value={help} onChange={(e) => setHelp(e.target.value)} placeholder="e.g. 3, 4" />
        </div>
        <div className="steppers">
          <Stepper id="r-other" label="Other modifier" value={other} set={setOther} min={-20} />
          <div className="field">
            <label htmlFor="r-diff">Difficulty (optional)</label>
            <input id="r-diff" inputMode="numeric" value={difficulty} onChange={(e) => setDifficulty(e.target.value.replace(/\D/g, ""))} />
          </div>
        </div>
        <label className="toggle"><input type="checkbox" checked={reaction} onChange={(e) => setReaction(e.target.checked)} /> <TermLink slug="reaction-roll" label="Reaction roll" /> (no Hope or Fear)</label>
        {error && <p className="msg msg-error" role="alert">{error}</p>}
        <div aria-live="polite">
          {result && (
            <div className={`roll-result ${result.kind}`}>
              <p className="roll-headline">{describeDuality(result)}</p>
              <p className="roll-total">{result.total}{result.difficulty !== null ? <small> vs {result.difficulty}</small> : null}</p>
              <p className="dice-faces">
                <span className="die hope" aria-label={`Hope die ${result.hope}`}>{result.hope}</span>
                <span className="die fear" aria-label={`Fear die ${result.fear}`}>{result.fear}</span>
                {result.extraDie && <span className={`die d6 ${result.extraDie.kind}`} aria-label={`${result.extraDie.kind} die ${result.extraDie.value}`}>{result.extraDie.kind === "advantage" ? "+" : "−"}{result.extraDie.value}</span>}
              </p>
              <p className="hint">{diceLine(result)}</p>
              <ul className="plain">{applied.map((n) => <li key={n}>{n}</li>)}</ul>
              {!settings.dice.autoApply && !result.reaction && result.kind !== "fear" && (
                <button type="button" onClick={() => { act((x) => applyDuality(x, d, result)); setApplied(["Applied."]); }}>Apply (gain Hope{result.kind === "crit" ? ", clear a Stress" : ""})</button>
              )}
              {weapon && (result.success !== false || result.kind === "crit") && (
                <button type="button" className="primary" onClick={rollDmg}>Roll damage{result.kind === "crit" ? " (critical)" : ""}</button>
              )}
              {damage && (
                <p className="roll-damage" aria-live="polite">
                  <strong>{damage.total}</strong> {weapon?.damage.type} damage <span className="hint">({damage.formula}: {damage.dice.join(" + ")}{damage.bonus ? ` ${formatMod(damage.bonus)}` : ""}{damage.crit ? ` + ${damage.critBonus} crit` : ""})</span>
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}

function diceLine(r: DualityResult) {
  const parts = [`Hope ${r.hope}`, `Fear ${r.fear}`, ...r.modifiers.map((m) => `${m.label} ${formatMod(m.value)}`)];
  if (r.extraDie) parts.push(`${r.extraDie.kind} ${r.extraDie.kind === "advantage" ? "+" : "−"}${r.extraDie.value}${r.extraDie.from === "ally" ? " (ally)" : ""}`);
  return `${parts.join(", ")} = ${r.total}`;
}

function Stepper({ id, label, value, set, min = 0 }: { id: string; label: string; value: number; set: (n: number) => void; min?: number }) {
  return (
    <div className="field">
      <label id={id}>{label}</label>
      <div className="counter" role="group" aria-labelledby={id}>
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => set(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`Increase ${label}`} onClick={() => set(value + 1)}>+</button>
      </div>
    </div>
  );
}

// ---------- damage taken ----------

export function DamagePanel({ c, d, act, remote }: PlayCtx) {
  const settings = useSettings();
  const [amount, setAmount] = useState("");
  const [useArmor, setUseArmor] = useState(true);
  const [resistant, setResistant] = useState(false);
  const [immune, setImmune] = useState(false);
  const [direct, setDirect] = useState(false);
  const n = Number(amount);
  const opts = { useArmor, resistant, immune, direct, massive: settings.dice.massiveDamage };
  const plan = amount ? planDamage(n, d, c, opts) : null;
  const armorFree = d.armorScore.total - c.state.armorMarked;
  return (
    <section aria-labelledby="dmg-h" className="damage">
      <h2 id="dmg-h">Take damage</h2>
      <form className="inline-form" onSubmit={(e) => {
        e.preventDefault();
        if (!plan) return;
        let notes: string[] = [];
        act((x) => { const r = takeDamage(x, d, n, opts); notes = r.notes; return r; });
        logRoll({ characterId: c.id, kind: "damage-taken", label: "Took damage", summary: `${n} → ${SEVERITY_LABEL[plan.severity]} (${plan.hp} HP)`, detail: plan.steps.join(" "), applied: notes }, remote);
        setAmount("");
      }}>
        <label htmlFor="dmg-amount" className="visually-hidden">Incoming damage</label>
        <input id="dmg-amount" inputMode="numeric" placeholder="Incoming damage" value={amount} onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))} />
        <button type="submit" className="primary" disabled={!plan}>Apply{plan ? ` (${plan.hp} HP${plan.armorUsed ? ", 1 Armor Slot" : ""})` : ""}</button>
      </form>
      <div className="toggles">
        <label className="toggle"><input type="checkbox" checked={useArmor} disabled={armorFree <= 0} onChange={(e) => setUseArmor(e.target.checked)} /> Mark an <TermLink slug="armor-slot" label="Armor Slot" /> ({Math.max(0, armorFree)} free)</label>
        <label className="toggle"><input type="checkbox" checked={resistant} onChange={(e) => setResistant(e.target.checked)} /> <TermLink slug="resistance" label="Resistant" /></label>
        <label className="toggle"><input type="checkbox" checked={immune} onChange={(e) => setImmune(e.target.checked)} /> <TermLink slug="immunity" label="Immune" /></label>
        <label className="toggle"><input type="checkbox" checked={direct} onChange={(e) => setDirect(e.target.checked)} /> <TermLink slug="direct-damage" label="Direct damage" /></label>
      </div>
      {plan && <p className="hint" aria-live="polite">{plan.steps.join(" ")} → mark {plan.hp} HP.</p>}
    </section>
  );
}

// ---------- roll log ----------

export function RollLog({ c }: { c: CharacterDoc }) {
  const { session, all, sessionStart } = useRollLog(c.id);
  const [showAll, setShowAll] = useState(false);
  const list = showAll ? all : session;
  return (
    <section aria-labelledby="log-h">
      <h2 id="log-h">Roll history</h2>
      <p className="hint">
        {sessionStart ? `This session started ${new Date(sessionStart).toLocaleString()}.` : "Showing all rolls."}{" "}
        <button type="button" onClick={() => startSession(c.id)}>Start a new session</button>{" "}
        <label className="toggle"><input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} /> Show earlier sessions</label>
      </p>
      {list.length === 0 ? <p>No rolls yet.</p> : (
        <ol className="roll-log">
          {list.map((r) => (
            <li key={r.id} className={r.kind}>
              <time dateTime={r.at}>{new Date(r.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</time>{" "}
              <strong>{r.summary}</strong> <span>{r.label}</span>
              <div className="hint">{r.detail}</div>
              {r.applied.length > 0 && <div className="hint">{r.applied.join(" ")}</div>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
