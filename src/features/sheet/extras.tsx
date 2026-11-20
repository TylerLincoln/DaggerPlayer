import { useState } from "react";
import { TRAITS, type Trait } from "../../../content/schema/index.ts";
import type { DerivedResource } from "../../rules/derive.ts";
import { dropBeastform, type Frequency, frequencyOf, markCompanionStress, resourceValue, rollPool, setResource, spendPoolDie, toggleUsed, transform, useKey } from "../../rules/sheet.ts";
import { formatMod } from "../../rules/traits.ts";
import { Inline, TermLink } from "../../ui/RichText.tsx";
import type { PlayCtx } from "./play.tsx";
import { CompanionEditor } from "./CompanionEditor.tsx";
import { CompanionOptionPicker } from "./CompanionOptionPicker.tsx";
import { COMPANION_OPTIONS, companionGaps, setCompanionLevelUp } from "../../rules/levelup.ts";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const FREQ_LABEL: Record<Frequency, string> = { scene: "this scene", rest: "this rest", "long-rest": "this long rest", session: "this session" };

/** "Used" checkbox for a feature with a once-per-X limit (cleared on rests / new sessions). */
export function UsedToggle({ text, name, c, act }: { text: string; name: string } & Pick<PlayCtx, "c" | "act">) {
  const freq = frequencyOf(text);
  if (!freq) return null;
  const key = useKey(freq, name);
  const used = !!c.state.resources[key];
  return (
    <label className="toggle used">
      <input type="checkbox" checked={used} onChange={() => act((x) => toggleUsed(x, key))} /> Used {FREQ_LABEL[freq]}
    </label>
  );
}

/** Token counter for cards that place tokens on themselves. */
export function TokenCounter({ cardId, name, c, act }: { cardId: string; name: string } & Pick<PlayCtx, "c" | "act">) {
  const key = `tokens:${cardId}`;
  const n = Number(c.state.resources[key] ?? 0);
  return (
    <span className="counter" role="group" aria-label={`${name} tokens`}>
      <span>Tokens</span>
      <button type="button" aria-label={`Remove a token from ${name}`} disabled={n <= 0} onClick={() => act((x) => setResource(x, key, n - 1))}>−</button>
      <output>{n}</output>
      <button type="button" aria-label={`Add a token to ${name}`} onClick={() => act((x) => setResource(x, key, n + 1))}>+</button>
    </span>
  );
}

function ResourceRow({ r, ctx }: { r: DerivedResource; ctx: PlayCtx }) {
  const { c, act } = ctx;
  const v = resourceValue(c, r);
  if (r.kind === "die") return <li><strong>{r.name}:</strong> {r.die} <span className="hint">({r.source})</span></li>;
  if (r.kind === "dice-pool") {
    const pool = Array.isArray(v) ? v : [];
    return (
      <li>
        <strong>{r.name}</strong> <span className="hint">({r.max} × {r.die}, rolled at the start of each session)</span>
        <div className="dice-faces left">
          {pool.length === 0 && <span className="hint">None rolled.</span>}
          {pool.map((n, i) => (
            <button key={i} type="button" className="die" aria-label={`Spend ${r.name} die showing ${n}`} onClick={() => act((x) => spendPoolDie(x, r.id, i))}>{n}</button>
          ))}
        </div>
        <button type="button" onClick={() => act((x) => rollPool(x, r.id, r.max, r.die ?? "d4"))}>Roll {r.max} {r.die}</button>
        <p className="hint">Tap a die to spend it (reduce damage, add to a roll after it's made, or gain that much Hope).</p>
      </li>
    );
  }
  if (r.kind === "die-value") {
    const n = Number(v);
    return (
      <li>
        <strong>{r.name}</strong> ({r.die}): {n === 0 ? "not active" : <>showing <strong>{n}</strong></>}{" "}
        {n === 0 ? (
          <button type="button" onClick={() => act((x) => setResource(x, r.id, 1, r.max))}>Start (1)</button>
        ) : (
          <>
            <button type="button" onClick={() => act((x) => setResource(x, r.id, n + 1 > r.max ? 0 : n + 1, r.max))}>{n + 1 > r.max ? "Exceeds max: remove" : "Increase"}</button>{" "}
            <button type="button" onClick={() => act((x) => setResource(x, r.id, 0, r.max))}>End</button>
          </>
        )}
      </li>
    );
  }
  const n = Number(v);
  return (
    <li className="counter" role="group" aria-label={`${r.name}: ${n} of ${r.max}`}>
      <strong>{r.name}</strong>
      <button type="button" aria-label={`Spend one ${r.name}`} disabled={n <= 0} onClick={() => act((x) => setResource(x, r.id, n - 1, r.max))}>−</button>
      <output>{n} / {r.max}</output>
      <button type="button" aria-label={`Gain one ${r.name}`} disabled={n >= r.max} onClick={() => act((x) => setResource(x, r.id, n + 1, r.max))}>+</button>
    </li>
  );
}

export function ResourcesPanel(ctx: PlayCtx) {
  const { d } = ctx;
  if (!d.resources.length) return null;
  return (
    <section aria-labelledby="res-h">
      <h2 id="res-h">Class resources</h2>
      <ul className="plain resources">{d.resources.map((r) => <ResourceRow key={r.id} r={r} ctx={ctx} />)}</ul>
    </section>
  );
}

export function BeastformPanel(ctx: PlayCtx & { onAttack: () => void }) {
  const { c, d, reg, act, onAttack } = ctx;
  const [form, setForm] = useState("");
  const [evo, setEvo] = useState<Trait | "">("");
  if (!d.features.some((f) => f.feature.name === "Beastform")) return null;
  const hasEvolution = d.features.some((f) => f.feature.name === "Evolution");
  const bf = d.beastform;
  return (
    <section aria-labelledby="bf-h">
      <h2 id="bf-h">Beastform</h2>
      {bf ? (
        <div className="feature">
          <h3>{bf.name} <span className="kind">· Tier {bf.tier}</span></h3>
          {bf.attack && <p>{cap(bf.attack.trait)} · {bf.attack.range} · {d.proficiency.total}{bf.attack.damage} {bf.attack.damageType} · Advantage on {bf.advantages.join(", ")}</p>}
          {bf.features.map((f) => <p key={f.name}><strong>{f.name}:</strong> <Inline text={f.text} /></p>)}
          {c.state.beastformEvolutionTrait && <p>Evolution: +1 {cap(c.state.beastformEvolutionTrait)}</p>}
          <p className="hint">You can't use weapons or cast spells from domain cards while transformed.</p>
          {bf.attack && <button type="button" className="primary" onClick={onAttack}>Attack as {bf.name}</button>}{" "}
          <button type="button" onClick={() => act((x) => dropBeastform(x))}>Drop out of Beastform</button>
        </div>
      ) : (
        <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (form) act((x) => transform(x, reg, form, evo ? { evolution: evo } : {})); }}>
          <label htmlFor="bf-form" className="visually-hidden">Beastform</label>
          <select id="bf-form" value={form} onChange={(e) => setForm(e.target.value)}>
            <option value="">Choose a form…</option>
            {reg.all("beastform").filter((b) => b.tier <= d.tier).map((b) => <option key={b.id} value={b.id}>T{b.tier} {b.name} ({b.examples})</option>)}
          </select>
          {hasEvolution && (
            <>
              <label htmlFor="bf-evo" className="visually-hidden">Evolution trait</label>
              <select id="bf-evo" value={evo} onChange={(e) => setEvo(e.target.value as Trait | "")}>
                <option value="">Mark a Stress</option>
                {TRAITS.map((t) => <option key={t} value={t} disabled={c.state.hope < 3}>Evolution: 3 Hope, +1 {cap(t)}</option>)}
              </select>
            </>
          )}
          <button type="submit" disabled={!form}>Transform</button>
        </form>
      )}
    </section>
  );
}

export function CompanionPanel(ctx: PlayCtx & { onAttack: () => void }) {
  const { c, d, act, onAttack } = ctx;
  const [editing, setEditing] = useState(false);
  if (!d.features.some((f) => f.source.startsWith("Beastbound"))) return null;
  const k = d.companion;
  if (!k || editing)
    return (
      <section aria-labelledby="comp-h">
        <h2 id="comp-h">Companion</h2>
        <CompanionEditor value={c.state.companion} onChange={(v) => act((x) => ((x.state.companion = v), x))} />
        {k && <button type="button" onClick={() => setEditing(false)}>Done</button>}
      </section>
    );
  const marked = c.state.companion!.stressMarked;
  const max = k.stressMax?.total ?? 0;
  return (
    <section aria-labelledby="comp-h">
      <h2 id="comp-h">Companion: {k.name} <small className="hint">{c.state.companion!.kind}</small></h2>
      <p><TermLink slug="evasion" label="Evasion" /> {k.evasion.total} · Attack: {c.state.companion!.attack || "standard attack"}, {k.range}, {d.proficiency.total}{k.die} {c.state.companion!.damageType}</p>
      <p>Experiences: {k.experiences.map((x) => `${x.name} ${formatMod(x.bonus)}`).join(", ")}</p>
      {k.options.length > 0 && <p className="hint">Options: {k.options.map((o) => o.split(":")[0]).join(", ")}</p>}
      {k.stressMax ? (
        <div className="track" role="group" aria-label={`Companion Stress: ${marked} of ${max} marked`}>
          <div className="track-label">Stress <span className="hint">{marked} / {max}</span></div>
          <div className="track-row">
            <button type="button" className="step" aria-label="Clear one companion Stress" disabled={marked === 0} onClick={() => act((x) => markCompanionStress(x, d, -1))}>−</button>
            <div className="boxes">{Array.from({ length: max }, (_, i) => <span key={i} className={`box stress${i < marked ? " on" : ""}`} />)}</div>
            <button type="button" className="step" aria-label="Mark one companion Stress" disabled={marked >= max} onClick={() => act((x) => markCompanionStress(x, d, 1))}>+</button>
          </div>
          <p className="hint">Your companion marks a Stress whenever they'd take damage.</p>
        </div>
      ) : (
        <p className="hint">Enter your companion's starting Stress (from the companion sheet) to track it.</p>
      )}
      <button type="button" className="primary" onClick={onAttack}>Command {k.name} to attack</button>{" "}
      <button type="button" onClick={() => setEditing(true)}>Edit companion</button>
      <CompanionLevelUps {...ctx} />
    </section>
  );
}

/** Label for a stored companion option ("vicious:die" → "Vicious (damage die)"). */
function optionLabel(reg: PlayCtx["reg"], c: PlayCtx["c"], opt: string | undefined): string {
  if (!opt) return "not chosen";
  const [base, detail] = opt.split(":");
  const prog = reg.get("srd/progression/leveling", "progression");
  const name = prog?.companionOptions[COMPANION_OPTIONS.indexOf(base)]?.name ?? base;
  if (base === "vicious") return `${name} (${detail === "range" ? "range" : "damage die"})`;
  if (base === "intelligent") {
    const xp = [...(c.state.companion?.experiences ?? []), ...c.levelUps.flatMap((x) => (x.companionExperience ? [x.companionExperience] : []))].find((x) => x.id === detail);
    return `${name} (${xp?.name ?? "?"} +1)`;
  }
  return name;
}

/** Companion choices for every level already gained: fill in missing ones (e.g. imported characters) or correct them. */
function CompanionLevelUps(ctx: PlayCtx) {
  const { c, d, reg, act } = ctx;
  const gaps = companionGaps(c, reg);
  const [editing, setEditing] = useState<number | null>(null);
  const [opt, setOpt] = useState<string | undefined>(undefined);
  const [xp, setXp] = useState("");
  if (c.levelUps.length === 0) return null;
  const start = (level: number) => {
    const lu = c.levelUps.find((x) => x.level === level);
    setEditing(level);
    setOpt(lu?.companionOption);
    setXp(lu?.companionExperience?.name ?? "");
  };
  return (
    <details className="companion-levels" open={gaps.length > 0}>
      <summary>
        Level-up options{gaps.length > 0 && <strong className="needs"> · {gaps.length} level{gaps.length > 1 ? "s" : ""} need a choice</strong>}
      </summary>
      <ul className="plain">
        {c.levelUps.map((lu) => (
          <li key={lu.level} className={gaps.includes(lu.level) ? "gap" : ""}>
            <span>
              <strong>Level {lu.level}:</strong> {optionLabel(reg, c, lu.companionOption)}
              {lu.companionExperience && <> · new Experience: {lu.companionExperience.name} +2</>}
            </span>{" "}
            <button type="button" className="link" onClick={() => start(lu.level)}>{lu.companionOption ? "Change" : "Choose"}</button>
            {editing === lu.level && (
              <form onSubmit={(e) => { e.preventDefault(); if (opt) act((x) => setCompanionLevelUp(x, reg, lu.level, opt, xp.trim() ? { name: xp.trim() } : undefined)); setEditing(null); }}>
                <CompanionOptionPicker c={c} d={d} reg={reg} level={lu.level} idPrefix={`cl-${lu.level}`} option={opt} experienceName={xp} onOption={setOpt} onExperience={setXp} />
                <button type="submit" className="primary" disabled={!opt}>Save level {lu.level}</button>{" "}
                <button type="button" onClick={() => setEditing(null)}>Cancel</button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
