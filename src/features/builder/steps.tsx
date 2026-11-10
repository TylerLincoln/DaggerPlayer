import { createContext, type ReactNode, useContext, useMemo, useState } from "react";
import { TRAITS, type Entry, type EntryOf, type Trait } from "../../../content/schema/index.ts";
import type { Registry } from "../../content/registry.ts";
import type { CharacterDoc } from "../../rules/character.ts";
import { POTIONS, STARTING_ITEMS } from "../../rules/builder.ts";
import { type Derived, derive, diffDerived, formatChange } from "../../rules/derive.ts";
import { assignTrait, clearTrait, formatMod, isValidSpread, remainingValues } from "../../rules/traits.ts";
import { DomainIcon } from "../../ui/DomainIcon.tsx";
import { Drawer } from "../../ui/Drawer.tsx";
import { Inline } from "../../ui/RichText.tsx";
import { EntryView } from "../compendium/EntryView.tsx";
import { ChoiceInput } from "../../ui/ChoiceInput.tsx";
import { CompanionEditor } from "../sheet/CompanionEditor.tsx";

interface Ctx {
  c: CharacterDoc;
  update: (fn: (d: CharacterDoc) => CharacterDoc) => void;
  reg: Registry;
  derived: Derived;
}
export const BuilderContext = createContext<Ctx>(null as unknown as Ctx);
const useB = () => useContext(BuilderContext);

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Stat changes the option would make compared with the current build. */
function useChanges(apply: (d: CharacterDoc) => void): string[] {
  const { c, reg, derived } = useB();
  return useMemo(() => {
    const next = structuredClone(c);
    apply(next);
    return diffDerived(derived, derive(next, reg)).map(formatChange);
  }, [c, reg, derived]); // eslint-disable-line react-hooks/exhaustive-deps
}

function Changes({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <ul className="changes" aria-label="Changes to your sheet">
      {list.map((x) => (
        <li key={x} className={x.startsWith("−") ? "neg" : "pos"}>
          {x}
        </li>
      ))}
    </ul>
  );
}

/** A selectable option with a details drawer and a stat-change preview. */
function Option({ entry, selected, onChoose, apply, summary, disabled, disabledReason, multi }: {
  entry: Entry;
  selected: boolean;
  onChoose: () => void;
  apply: (d: CharacterDoc) => void;
  summary?: ReactNode;
  disabled?: boolean;
  disabledReason?: string;
  multi?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const changes = useChanges(apply);
  const label = multi ? (selected ? "Remove" : "Add") : selected ? "Chosen" : "Choose";
  return (
    <li className={`option${selected ? " selected" : ""}`}>
      <div className="option-main">
        <strong>
          {entry.type === "domain" && <DomainIcon pack={entry.pack} icon={entry.icon} size={18} />} {entry.name}
        </strong>
        {summary && <div className="option-summary">{summary}</div>}
        {!selected && <Changes list={changes} />}
        {disabled && disabledReason && <p className="hint">{disabledReason}</p>}
      </div>
      <div className="option-actions">
        <button type="button" onClick={() => setOpen(true)} aria-label={`Details: ${entry.name}`}>
          Details
        </button>
        <button type="button" className={selected ? "primary" : ""} aria-pressed={selected} disabled={disabled && !selected} onClick={onChoose}>
          {label}
        </button>
      </div>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={entry.name}
        footer={
          <>
            {!selected && <Changes list={changes} />}
            <button type="button" className="primary" disabled={disabled && !selected} onClick={() => { onChoose(); setOpen(false); }}>
              {label} {entry.name}
            </button>
          </>
        }
      >
        <EntryView e={entry} />
      </Drawer>
    </li>
  );
}

// ---------- 1. class & subclass ----------

export function ClassStep() {
  const { c, update, reg } = useB();
  const cls = reg.get(c.build.classId, "class");
  const choose = (id: string) =>
    update((d) => {
      if (d.build.classId === id) return d;
      const next = reg.get(id, "class")!;
      d.build.classId = id;
      d.build.subclassId = null;
      d.build.gear.classItem = null;
      d.build.domainCardIds = d.build.domainCardIds.filter((x) => next.domainIds.includes(reg.get(x, "domain-card")?.domainId ?? ""));
      d.build.background = next.backgroundQuestions.map((q) => ({ question: q, answer: "" }));
      d.build.connections = next.connectionQuestions.map((q) => ({ question: q, answer: "" }));
      return d;
    });
  return (
    <>
      <h2>Choose a class</h2>
      <ul className="options">
        {reg.all("class").map((k) => (
          <Option
            key={k.id}
            entry={k}
            selected={k.id === c.build.classId}
            onChoose={() => choose(k.id)}
            apply={(d) => { d.build.classId = k.id; d.build.subclassId = null; }}
            summary={
              <>
                <p className="domains">{k.domainIds.map((id) => { const dm = reg.get(id, "domain"); return <span key={id}><DomainIcon pack={dm?.pack ?? "srd"} icon={dm?.icon} size={16} /> {dm?.name} </span>; })}</p>
                <p>Evasion {k.startingEvasion} · HP {k.startingHp}</p>
                <p className="hint">Hope: {k.hopeFeature.name} · Class: {k.classFeatures.map((f) => f.name).join(", ")}</p>
              </>
            }
          />
        ))}
      </ul>
      {cls && (
        <>
          <h2>Choose a {cls.name} subclass</h2>
          <ul className="options">
            {cls.subclassIds.map((id) => reg.get(id, "subclass")).filter((s): s is EntryOf<"subclass"> => !!s).map((s) => (
              <Option
                key={s.id}
                entry={s}
                selected={s.id === c.build.subclassId}
                onChoose={() => update((d) => ((d.build.subclassId = s.id), d))}
                apply={(d) => (d.build.subclassId = s.id)}
                summary={
                  <>
                    <p>Spellcast trait: {s.spellcastTrait ? cap(s.spellcastTrait) : "none"}</p>
                    <p className="hint">Foundation: {s.foundation.map((f) => f.name).join(", ")}</p>
                  </>
                }
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}

// ---------- 2. heritage ----------

export function HeritageStep() {
  const { c, update, reg } = useB();
  const a = c.build.ancestry;
  const mixed = a?.kind === "mixed";
  const ancestries = reg.all("ancestry");
  return (
    <>
      <h2>Ancestry</h2>
      <div role="radiogroup" aria-label="Ancestry type" className="segmented">
        <button type="button" role="radio" aria-checked={!mixed} onClick={() => update((d) => ((d.build.ancestry = null), d))}>Single ancestry</button>
        <button type="button" role="radio" aria-checked={mixed} onClick={() => update((d) => ((d.build.ancestry = { kind: "mixed", topFrom: "", bottomFrom: "", label: "" }), d))}>Mixed ancestry</button>
      </div>
      {!mixed ? (
        <ul className="options">
          {ancestries.map((x) => (
            <Option
              key={x.id}
              entry={x}
              selected={a?.kind === "single" && a.id === x.id}
              onChoose={() => update((d) => ((d.build.ancestry = { kind: "single", id: x.id }), d))}
              apply={(d) => (d.build.ancestry = { kind: "single", id: x.id })}
              summary={<p className="hint">{x.features.map((f) => f.name).join(" · ")}</p>}
            />
          ))}
        </ul>
      ) : (
        <div className="mixed">
          <p className="hint">A mixed ancestry takes the top (first) feature of one ancestry and the bottom (second) feature of another (SRD p. 4).</p>
          {(["topFrom", "bottomFrom"] as const).map((slot, n) => (
            <div className="field" key={slot}>
              <label htmlFor={slot}>{n === 0 ? "Top feature from" : "Bottom feature from"}</label>
              <select id={slot} value={a[slot]} onChange={(e) => update((d) => { if (d.build.ancestry?.kind === "mixed") d.build.ancestry[slot] = e.target.value; return d; })}>
                <option value="">Choose…</option>
                {ancestries.map((x) => <option key={x.id} value={x.id}>{x.name}: {x.features[n].name}</option>)}
              </select>
            </div>
          ))}
          <div className="field">
            <label htmlFor="mix-label">Heritage name (optional)</label>
            <input id="mix-label" value={a.label} maxLength={80} placeholder="e.g. Goblin-Orc" onChange={(e) => update((d) => { if (d.build.ancestry?.kind === "mixed") d.build.ancestry.label = e.target.value; return d; })} />
          </div>
        </div>
      )}
      <h2>Community</h2>
      <ul className="options">
        {reg.all("community").map((x) => (
          <Option key={x.id} entry={x} selected={x.id === c.build.communityId} onChoose={() => update((d) => ((d.build.communityId = x.id), d))} apply={(d) => (d.build.communityId = x.id)}
            summary={<p className="hint">{x.feature.name} · often {x.adjectives.join(", ")}</p>} />
        ))}
      </ul>
      <details className="optional">
        <summary>Transformation (optional, with GM approval)</summary>
        <p className="hint">Transformations are optional and usually granted by the GM during play (SRD p. 42). A PC can't have more than one.</p>
        <ul className="options">
          {reg.all("transformation").map((x) => (
            <Option key={x.id} entry={x} selected={x.id === c.build.transformationId}
              onChoose={() => update((d) => ((d.build.transformationId = d.build.transformationId === x.id ? null : x.id), d))}
              apply={(d) => (d.build.transformationId = x.id)} summary={<p className="hint">{x.features.map((f) => f.name).join(" · ")}</p>} />
          ))}
        </ul>
      </details>
    </>
  );
}

// ---------- 3. traits ----------

export function TraitsStep() {
  const { c, update, derived } = useB();
  const t = c.build.traits;
  const [picked, setPicked] = useState<{ value: number } | { trait: Trait } | null>(null);
  const pool = remainingValues(t);
  const give = (trait: Trait, value: number) => {
    update((d) => ((d.build.traits = assignTrait(d.build.traits, trait, value)), d));
    setPicked(null);
  };
  const onValue = (value: number) => (picked && "trait" in picked ? give(picked.trait, value) : setPicked({ value }));
  const onTrait = (trait: Trait) => (picked && "value" in picked ? give(trait, picked.value) : setPicked({ trait }));
  return (
    <>
      <h2>Assign traits</h2>
      <p>Give your traits +2, +1, +1, +0, +0 and −1 in any order. Tap a value and then a trait (or the other way round), or drag a value onto a trait.</p>
      <div className="trait-pool" aria-label="Values to assign">
        {pool.length === 0 && <span className="hint">All values assigned.</span>}
        {pool.map((v, i) => (
          <button key={`${v}-${i}`} type="button" className={`chip${picked && "value" in picked && picked.value === v ? " active" : ""}`} draggable
            aria-pressed={!!picked && "value" in picked && picked.value === v}
            onDragStart={(e) => e.dataTransfer.setData("text/plain", String(v))} onClick={() => onValue(v)}>
            {formatMod(v)}
          </button>
        ))}
      </div>
      <ul className="traits">
        {TRAITS.map((tr) => {
          const total = derived.traits[tr];
          const other = total.parts.filter((p) => p.source !== "Assigned");
          return (
            <li key={tr} onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); give(tr, Number(e.dataTransfer.getData("text/plain"))); }}>
              <button type="button" className={`trait${picked && "trait" in picked && picked.trait === tr ? " active" : ""}`} onClick={() => onTrait(tr)}
                aria-label={`${cap(tr)}: ${t[tr] === null ? "unassigned" : formatMod(t[tr]!)}`}>
                <span className="trait-name">{cap(tr)}</span>
                <span className="trait-value">{t[tr] === null ? "—" : formatMod(t[tr]!)}</span>
              </button>
              {t[tr] !== null && <button type="button" className="link" onClick={() => update((d) => ((d.build.traits = clearTrait(d.build.traits, tr)), d))}>Clear</button>}
              {other.length > 0 && <span className="hint">Total {formatMod(total.total)} ({other.map((p) => `${p.source} ${formatMod(p.value)}`).join(", ")})</span>}
            </li>
          );
        })}
      </ul>
      <p role="status" className="hint">{isValidSpread(t) ? "All six traits assigned." : `${pool.length} value${pool.length === 1 ? "" : "s"} left to assign.`}</p>
    </>
  );
}

// ---------- 4. gear ----------

const dmg = (w: EntryOf<"weapon">) => `${w.damage.dice}${w.damage.bonus ? `+${w.damage.bonus}` : ""} ${w.damage.type}`;
const RANGE: Record<string, string> = { melee: "Melee", "very-close": "Very Close", close: "Close", far: "Far", "very-far": "Very Far" };

export function GearStep() {
  const { c, update, reg, derived } = useB();
  const g = c.build.gear;
  const cls = reg.get(c.build.classId, "class");
  const primary = reg.get(g.primaryId, "weapon");
  const canCast = derived.spellcastTraits.length > 0;
  const tier1 = reg.all("weapon").filter((w) => w.tier === 1);
  const weaponOption = (w: EntryOf<"weapon">, slot: "primaryId" | "secondaryId") => {
    const blockedMagic = w.damage.type === "mag" && !canCast;
    const blockedTwoHanded = slot === "secondaryId" && primary?.burden === 2;
    return (
      <Option key={w.id} entry={w} selected={g[slot] === w.id}
        onChoose={() => update((d) => {
          d.build.gear[slot] = d.build.gear[slot] === w.id ? null : w.id;
          if (slot === "primaryId" && w.burden === 2) d.build.gear.secondaryId = null;
          return d;
        })}
        apply={(d) => { d.build.gear[slot] = w.id; if (slot === "primaryId" && w.burden === 2) d.build.gear.secondaryId = null; }}
        disabled={blockedMagic || blockedTwoHanded}
        disabledReason={blockedMagic ? "Magic weapons need a Spellcast trait (from your subclass)." : blockedTwoHanded ? "Your primary weapon is two-handed." : undefined}
        summary={<p>{cap(w.trait)} · {RANGE[w.range]} · {dmg(w)} · {w.burden === 1 ? "One-Handed" : "Two-Handed"}{w.feature ? <> · <em>{w.feature.name}</em></> : null}</p>}
      />
    );
  };
  const [weaponGroup, setWeaponGroup] = useState<"physical" | "magic">("physical");
  return (
    <>
      <h2>Weapons</h2>
      <p>Choose a two-handed primary weapon, or a one-handed primary weapon and a one-handed secondary weapon, from Tier 1 (SRD p. 5).</p>
      <div role="radiogroup" aria-label="Weapon list" className="segmented">
        <button type="button" role="radio" aria-checked={weaponGroup === "physical"} onClick={() => setWeaponGroup("physical")}>Physical</button>
        <button type="button" role="radio" aria-checked={weaponGroup === "magic"} onClick={() => setWeaponGroup("magic")}>Magic</button>
      </div>
      <h3>Primary weapon</h3>
      <ul className="options">{tier1.filter((w) => w.category === "primary" && w.group === weaponGroup).map((w) => weaponOption(w, "primaryId"))}</ul>
      <h3>Secondary weapon (optional)</h3>
      <ul className="options">{tier1.filter((w) => w.category === "secondary").map((w) => weaponOption(w, "secondaryId"))}</ul>
      <h2>Armor</h2>
      <ul className="options">
        {reg.all("armor").filter((a) => a.tier === 1).map((a) => (
          <Option key={a.id} entry={a} selected={g.armorId === a.id} onChoose={() => update((d) => ((d.build.gear.armorId = a.id), d))} apply={(d) => (d.build.gear.armorId = a.id)}
            summary={<p>Thresholds {a.baseThresholds.major}/{a.baseThresholds.severe} · Armor Score {a.baseScore}{a.feature ? <> · <em>{a.feature.name}</em></> : null}</p>} />
        ))}
      </ul>
      <h2>Starting items</h2>
      <p>You also carry: {STARTING_ITEMS.join(", ")}, and a handful of gold.</p>
      <fieldset>
        <legend>Potion</legend>
        {(Object.keys(POTIONS) as (keyof typeof POTIONS)[]).map((p) => (
          <label key={p} className="radio">
            <input type="radio" name="potion" checked={g.potion === p} onChange={() => update((d) => ((d.build.gear.potion = p), d))} /> {POTIONS[p]} ({p === "health" ? "clear 1d4 Hit Points" : "clear 1d4 Stress"})
          </label>
        ))}
      </fieldset>
      {cls && (
        <fieldset>
          <legend>Class item</legend>
          {cls.classItems.map((it) => (
            <label key={it} className="radio">
              <input type="radio" name="class-item" checked={g.classItem === it} onChange={() => update((d) => ((d.build.gear.classItem = it), d))} /> {it}
            </label>
          ))}
        </fieldset>
      )}
      {canCast && (
        <div className="field">
          <label htmlFor="spell-item">Item that carries your spells (optional)</label>
          <input id="spell-item" value={g.spellItem} maxLength={200} onChange={(e) => update((d) => ((d.build.gear.spellItem = e.target.value), d))} />
        </div>
      )}
      <div className="field">
        <label htmlFor="extra">Other GM-approved items (one per line)</label>
        <textarea id="extra" rows={3} value={g.extraItems} maxLength={1000} onChange={(e) => update((d) => ((d.build.gear.extraItems = e.target.value), d))} />
      </div>
    </>
  );
}

// ---------- 5. background & experiences ----------

const EXAMPLE_EXPERIENCES = ["Bodyguard", "Field Medic", "Scholar", "Silver Tongue", "Survivor", "Navigator", "Tracker", "Sticky Fingers", "I’ve Got Your Back"];

export function BackgroundStep() {
  const { c, update, derived } = useB();
  const set = (fn: (d: CharacterDoc) => void) => update((d) => (fn(d), d));
  const choices = derived.features.flatMap(({ feature }) => (feature.choices ?? []).map((ch) => ({ feature, ch })));
  return (
    <>
      <h2>Who are you?</h2>
      <div className="field"><label htmlFor="name">Name</label><input id="name" value={c.identity.name} maxLength={120} onChange={(e) => set((d) => (d.identity.name = e.target.value))} /></div>
      <div className="field"><label htmlFor="pronouns">Pronouns</label><input id="pronouns" value={c.identity.pronouns} maxLength={40} onChange={(e) => set((d) => (d.identity.pronouns = e.target.value))} /></div>
      <div className="field"><label htmlFor="desc">Description</label><textarea id="desc" rows={3} value={c.identity.description} maxLength={4000} onChange={(e) => set((d) => (d.identity.description = e.target.value))} /></div>

      <h2>Experiences</h2>
      <p>Two Experiences at +2 each: a word or phrase for a set of skills, traits or aptitudes. Not too broad (“Lucky”) and no special powers (SRD p. 5).</p>
      {c.build.experiences.map((x, i) => (
        <div className="field" key={x.id}>
          <label htmlFor={`xp-${i}`}>Experience {i + 1} (+{x.bonus})</label>
          <input id={`xp-${i}`} value={x.name} maxLength={80} list="xp-examples" onChange={(e) => set((d) => (d.build.experiences[i].name = e.target.value))} />
        </div>
      ))}
      <datalist id="xp-examples">{EXAMPLE_EXPERIENCES.map((x) => <option key={x} value={x} />)}</datalist>

      {choices.map(({ feature, ch }) => (
        <ChoiceInput key={ch.id} choice={ch} label={feature.name} value={c.build.featureChoices[ch.id]} experiences={c.build.experiences}
          onChange={(v) => set((d) => (d.build.featureChoices[ch.id] = v))} />
      ))}
      {c.build.subclassId === "srd/subclass/beastbound" && (
        <CompanionEditor value={c.state.companion} onChange={(k) => set((d) => (d.state.companion = k))} />
      )}

      <h2>Background</h2>
      {c.build.background.length === 0 && <p className="hint">Choose a class to see its background questions.</p>}
      {c.build.background.map((q, i) => (
        <div className="field" key={i}>
          <label htmlFor={`bg-${i}`}><Inline text={q.question} links={false} /></label>
          <textarea id={`bg-${i}`} rows={2} value={q.answer} maxLength={4000} onChange={(e) => set((d) => (d.build.background[i].answer = e.target.value))} />
        </div>
      ))}
      <div className="field">
        <label htmlFor="class-notes">Class feature choices and notes</label>
        <textarea id="class-notes" rows={3} value={c.build.classNotes} maxLength={4000} placeholder="e.g. your patron's name and sphere of influence, your companion" onChange={(e) => set((d) => (d.build.classNotes = e.target.value))} />
        <small className="hint">If a class feature asks you to choose something at creation (SRD p. 4), note it here.</small>
      </div>
    </>
  );
}

// ---------- 6. domain cards ----------

export function CardsStep() {
  const { c, update, reg } = useB();
  const cls = reg.get(c.build.classId, "class");
  if (!cls) return <p>Choose a class first: your class decides which domains you can draw cards from.</p>;
  const chosen = c.build.domainCardIds;
  const toggle = (id: string) =>
    update((d) => {
      const has = d.build.domainCardIds.includes(id);
      d.build.domainCardIds = has ? d.build.domainCardIds.filter((x) => x !== id) : [...d.build.domainCardIds, id].slice(-2);
      return d;
    });
  return (
    <>
      <h2>Choose two level 1 domain cards</h2>
      <p>One from each of your domains, or both from one (SRD p. 6). {chosen.length} of 2 chosen.</p>
      {cls.domainIds.map((did) => {
        const dm = reg.get(did, "domain");
        const cards = (reg.childrenOf(did) as EntryOf<"domain-card">[]).filter((x) => x.level === 1);
        return (
          <section key={did}>
            <h3><DomainIcon pack={dm?.pack ?? "srd"} icon={dm?.icon} size={22} /> {dm?.name}</h3>
            <ul className="options">
              {cards.map((card) => (
                <Option key={card.id} entry={card} multi selected={chosen.includes(card.id)} onChoose={() => toggle(card.id)}
                  apply={(d) => (d.build.domainCardIds = [...d.build.domainCardIds.filter((x) => x !== card.id), card.id].slice(-2))}
                  disabled={chosen.length >= 2 && !chosen.includes(card.id)} disabledReason={chosen.length >= 2 && !chosen.includes(card.id) ? "Remove a card to choose this one." : undefined}
                  summary={<p>{cap(card.cardType)} · Recall cost {card.recallCost}</p>} />
              ))}
            </ul>
          </section>
        );
      })}
    </>
  );
}

// ---------- 7. connections ----------

export function ConnectionsStep() {
  const { c, update } = useB();
  return (
    <>
      <h2>Connections</h2>
      <p>Connections are made at the table: describe your characters to each other, then suggest at least one connection with each other PC. Use these questions for inspiration (SRD p. 6).</p>
      {c.build.connections.length === 0 && <p className="hint">Choose a class to see its connection questions.</p>}
      {c.build.connections.map((q, i) => (
        <div className="field" key={i}>
          <label htmlFor={`cn-${i}`}><Inline text={q.question} links={false} /></label>
          <textarea id={`cn-${i}`} rows={2} value={q.answer} maxLength={4000} onChange={(e) => update((d) => ((d.build.connections[i].answer = e.target.value), d))} />
        </div>
      ))}
      <div className="field">
        <label htmlFor="cn-notes">Other connections</label>
        <textarea id="cn-notes" rows={3} value={c.notes.connections} maxLength={4000} onChange={(e) => update((d) => ((d.notes.connections = e.target.value), d))} />
      </div>
    </>
  );
}

export { derive };
