import { useMemo, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { TRAITS, type EntryOf, type Trait } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import type { Registry } from "../../content/registry.ts";
import { useAutosave, useCharacterRecord } from "../../data/characters.ts";
import type { CharacterDoc, LevelUp } from "../../rules/character.ts";
import { ACHIEVEMENT_LEVELS, derive, diffDerived, formatChange, tierOf } from "../../rules/derive.ts";
import { type Advancement, applyLevelUp, cardLevelLimit, emptyLevelUp, markedTraits, MAX_LEVEL, optionStatus, ownedCards, validateLevelUp } from "../../rules/levelup.ts";
import { Inline } from "../../ui/RichText.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Cards the character could take at `level`: from their domains (multiclass domain ≤ half level), not already owned or picked. */
function eligibleCards(c: CharacterDoc, reg: Registry, level: number, exclude: string[], mc?: Advancement, maxLevel = 10) {
  const owned = new Set([...ownedCards(c), ...exclude]);
  return reg.all("domain-card").filter((card) => {
    const limit = cardLevelLimit(c, reg, level, card.domainId, mc);
    return limit > 0 && card.level <= Math.min(limit, maxLevel) && !owned.has(card.id);
  });
}

function CardSelect({ id, label, value, cards, reg, onChange }: { id: string; label: string; value: string | null | undefined; cards: EntryOf<"domain-card">[]; reg: Registry; onChange: (v: string | null) => void }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Choose a card…</option>
        {cards.sort((a, b) => a.domainId.localeCompare(b.domainId) || a.level - b.level).map((x) => (
          <option key={x.id} value={x.id}>{reg.get(x.domainId)?.name} {x.level} · {x.name} ({x.cardType})</option>
        ))}
      </select>
    </div>
  );
}

function PickDetails({ a, set, c, reg, lu }: { a: Advancement; set: (a: Advancement) => void; c: CharacterDoc; reg: Registry; lu: LevelUp }) {
  const marked = markedTraits(c.levelUps, lu.level);
  const otherTraits = lu.advancements.filter((x) => x !== a && x.optionId === "traits").flatMap((x) => x.traits ?? []);
  const xps = [...c.build.experiences, ...c.levelUps.flatMap((x) => (x.newExperience ? [x.newExperience] : [])), ...(lu.newExperience ? [lu.newExperience] : [])];
  switch (a.optionId) {
    case "traits":
      return (
        <fieldset>
          <legend>Two unmarked traits (+1 each)</legend>
          {TRAITS.map((t) => {
            const blocked = marked.has(t) || otherTraits.includes(t);
            const on = a.traits?.includes(t) ?? false;
            return (
              <label key={t} className="radio">
                <input type="checkbox" checked={on} disabled={blocked || (!on && (a.traits?.length ?? 0) >= 2)}
                  onChange={() => set({ ...a, traits: on ? a.traits!.filter((x) => x !== t) : [...(a.traits ?? []), t as Trait] })} />
                {cap(t)} {blocked && <small>(marked)</small>}
              </label>
            );
          })}
        </fieldset>
      );
    case "experiences":
      return (
        <fieldset>
          <legend>Two Experiences (+1 each)</legend>
          {xps.map((x) => {
            const on = a.experienceIds?.includes(x.id) ?? false;
            return (
              <label key={x.id} className="radio">
                <input type="checkbox" checked={on} disabled={!on && (a.experienceIds?.length ?? 0) >= 2}
                  onChange={() => set({ ...a, experienceIds: on ? a.experienceIds!.filter((y) => y !== x.id) : [...(a.experienceIds ?? []), x.id] })} />
                {x.name || "(new Experience)"}
              </label>
            );
          })}
        </fieldset>
      );
    case "domain-card": {
      const mc = lu.advancements.find((x) => x.optionId === "multiclass");
      const exclude = [lu.domainCardId ?? "", ...lu.advancements.filter((x) => x !== a && x.cardId).map((x) => x.cardId!)];
      return <CardSelect id="adv-card" label="Additional domain card" value={a.cardId} reg={reg} cards={eligibleCards(c, reg, lu.level, exclude, mc)} onChange={(v) => set({ ...a, cardId: v ?? undefined })} />;
    }
    case "subclass": {
      const sub = reg.get(c.build.subclassId, "subclass");
      const have = c.levelUps.flatMap((x) => x.advancements).filter((x) => x.optionId === "subclass").length;
      return <p>You gain the <strong>{have === 0 ? "specialization" : "mastery"}</strong> card for {sub?.name}: {(have === 0 ? sub?.specialization : sub?.mastery)?.map((f) => f.name).join(", ")}.</p>;
    }
    case "multiclass": {
      const mc = reg.get(a.classId, "class");
      return (
        <div>
          <div className="field">
            <label htmlFor="mc-class">Class</label>
            <select id="mc-class" value={a.classId ?? ""} onChange={(e) => set({ optionId: "multiclass", classId: e.target.value || undefined })}>
              <option value="">Choose…</option>
              {reg.all("class").filter((k) => k.id !== c.build.classId).map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
            </select>
          </div>
          {mc && (
            <>
              <div className="field">
                <label htmlFor="mc-domain">Domain</label>
                <select id="mc-domain" value={a.domainId ?? ""} onChange={(e) => set({ ...a, domainId: e.target.value || undefined })}>
                  <option value="">Choose…</option>
                  {mc.domainIds.map((d) => <option key={d} value={d}>{reg.get(d)?.name}</option>)}
                </select>
              </div>
              <div className="field">
                <label htmlFor="mc-sub">Foundation card from</label>
                <select id="mc-sub" value={a.subclassId ?? ""} onChange={(e) => set({ ...a, subclassId: e.target.value || undefined })}>
                  <option value="">Choose…</option>
                  {mc.subclassIds.map((s) => <option key={s} value={s}>{reg.get(s)?.name}</option>)}
                </select>
              </div>
              <p className="hint">You also gain {mc.name}'s class feature: {mc.classFeatures.map((f) => f.name).join(", ")}. Cards from the new domain are limited to half your level, rounded up.</p>
            </>
          )}
        </div>
      );
    }
    default:
      return null;
  }
}

export function LevelUpPage() {
  const { id } = useParams();
  const { registry: reg } = useContent();
  const { user } = useAuth();
  const [rec, update] = useCharacterRecord(id);
  const { save } = useAutosave(id, user?.id ?? null);
  const navigate = useNavigate();
  const [lu, setLu] = useState<LevelUp | null>(null);
  const c = rec?.doc;
  const draft = useMemo(() => lu ?? (c ? emptyLevelUp(c) : null), [lu, c]);

  if (!c || !draft) return <><h1>Character not found</h1><Link to="/characters">Your characters</Link></>;
  if (!c.finishedAt) return <Navigate to={`/build/${c.id}/review`} replace />;
  if (!reg) return <p role="status">Loading content…</p>;
  if (c.levelUps.length + 1 >= MAX_LEVEL) return <><h1>{c.identity.name} is level {MAX_LEVEL}</h1><p>That's the highest level.</p><Link to={`/characters/${c.id}`}>Back</Link></>;

  const set = (fn: (x: LevelUp) => LevelUp) => setLu(fn(structuredClone(draft)));
  const level = draft.level;
  const statuses = optionStatus(c, reg, level, draft.advancements);
  const errors = validateLevelUp(c, draft, reg);
  const before = derive(c, reg);
  const after = derive({ ...c, levelUps: [...c.levelUps, draft] }, reg);
  const changes = diffDerived(before, after).map(formatChange);
  const mc = draft.advancements.find((a) => a.optionId === "multiclass");
  const advCards = draft.advancements.filter((a) => a.cardId).map((a) => a.cardId!);
  const used = draft.advancements.reduce((n, a) => n + (statuses.find((s) => s.id === a.optionId)?.cost ?? 1), 0);

  const confirm = async () => {
    update((d) => applyLevelUp(d, draft, reg));
    if (user) await save("level-up");
    navigate(`/characters/${c.id}`);
  };

  return (
    <div className="levelup">
      <h1>Level up {c.identity.name} to level {level}</h1>
      <p className="hint">Tier {tierOf(level)}. SRD pp. 53–54.</p>

      <section aria-labelledby="s1">
        <h2 id="s1">1. Tier achievements</h2>
        {ACHIEVEMENT_LEVELS.includes(level) ? (
          <>
            <p>You gain a new Experience at +2 and a permanent +1 to Proficiency{level >= 5 ? ", and all trait marks clear" : ""}.</p>
            <div className="field">
              <label htmlFor="new-xp">New Experience (+2)</label>
              <input id="new-xp" value={draft.newExperience?.name ?? ""} maxLength={80} onChange={(e) => set((x) => ((x.newExperience = { ...x.newExperience!, name: e.target.value }), x))} />
            </div>
          </>
        ) : (
          <p>No tier achievement at this level.</p>
        )}
      </section>

      <section aria-labelledby="s2">
        <h2 id="s2">2. Advancements ({used} of 2)</h2>
        <p>Choose two with an unmarked slot from your tier or below. Options marked “uses both” take both picks.</p>
        <ul className="advancements">
          {statuses.map((s) => {
            const picks = draft.advancements.map((a, i) => ({ a, i })).filter(({ a }) => a.optionId === s.id);
            return (
              <li key={s.id} className={picks.length ? "selected" : ""}>
                <div>
                  <Inline text={s.text} />
                  <p className="hint">{s.slotsLeft} slot{s.slotsLeft === 1 ? "" : "s"} left{s.cost === 2 ? " · uses both picks" : ""}{!s.available && s.reason ? ` · ${s.reason}` : ""}</p>
                </div>
                <button type="button" disabled={!s.available}
                  onClick={() => set((x) => ((x.advancements = [...x.advancements, { optionId: s.id, ...(s.id === "subclass" ? { subclassId: c.build.subclassId! } : {}) }]), x))}>
                  Add
                </button>
                {picks.map(({ a, i }) => (
                  <div key={i} className="pick">
                    <PickDetails a={a} c={c} reg={reg} lu={draft} set={(na) => set((x) => ((x.advancements[i] = na), x))} />
                    <button type="button" className="link" onClick={() => set((x) => ((x.advancements = x.advancements.filter((_, k) => k !== i)), x))}>Remove</button>
                  </div>
                ))}
              </li>
            );
          })}
        </ul>
      </section>

      <section aria-labelledby="s3">
        <h2 id="s3">3. Damage thresholds</h2>
        <p>Your thresholds increase by 1 (your level is added to them): {before.thresholds.major.total}/{before.thresholds.severe.total} → {after.thresholds.major.total}/{after.thresholds.severe.total}.</p>
      </section>

      <section aria-labelledby="s4">
        <h2 id="s4">4. Domain card</h2>
        <CardSelect id="lvl-card" label={`New domain card (level ${level} or lower)`} value={draft.domainCardId} reg={reg}
          cards={eligibleCards(c, reg, level, advCards, mc)} onChange={(v) => set((x) => ((x.domainCardId = v), x))} />
        <details>
          <summary>Exchange a card (optional)</summary>
          <div className="field">
            <label htmlFor="ex-from">Give up</label>
            <select id="ex-from" value={draft.exchange?.fromId ?? ""} onChange={(e) => set((x) => ((x.exchange = e.target.value ? { fromId: e.target.value, toId: "" } : null), x))}>
              <option value="">No exchange</option>
              {ownedCards(c).map((cid) => { const card = reg.get(cid, "domain-card"); return <option key={cid} value={cid}>{card?.name} (level {card?.level})</option>; })}
            </select>
          </div>
          {draft.exchange?.fromId && (
            <CardSelect id="ex-to" label="Take instead (same level or lower)" value={draft.exchange.toId} reg={reg}
              cards={eligibleCards(c, reg, level, [...advCards, draft.domainCardId ?? ""], mc, reg.get(draft.exchange.fromId, "domain-card")?.level)}
              onChange={(v) => set((x) => ((x.exchange = { fromId: x.exchange!.fromId, toId: v ?? "" }), x))} />
          )}
        </details>
      </section>

      <section aria-labelledby="sum">
        <h2 id="sum">Summary</h2>
        <ul className="changes">{changes.map((x) => <li key={x} className={x.startsWith("−") ? "neg" : "pos"}>{x}</li>)}</ul>
        {errors.length > 0 && <ul className="issues">{errors.map((e) => <li key={e} className="error">{e}</li>)}</ul>}
        <button type="button" className="primary" disabled={errors.length > 0} onClick={confirm}>Level up to {level}</button>{" "}
        <Link to={`/characters/${c.id}`}>Cancel</Link>
      </section>
    </div>
  );
}
