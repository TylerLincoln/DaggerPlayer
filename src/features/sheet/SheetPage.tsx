import { useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { TRAITS, type EntryOf } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import type { Registry } from "../../content/registry.ts";
import { useAutosave, useCharacterRecord } from "../../data/characters.ts";
import type { CharacterDoc } from "../../rules/character.ts";
import { type Derived, derive, type Stat } from "../../rules/derive.ts";
import { MAX_LEVEL, undoLastLevelUp } from "../../rules/levelup.ts";
import { addGold, CONSUMABLE_MAX, DOWNTIME_MOVES, type DowntimeMove, fromVault, INVENTORY_WEAPONS_MAX, mustLongRest, type RestKind, type Result, RuleError, setItemQty, stressVulnerable, swapWeapon, takeRest, toVault } from "../../rules/sheet.ts";
import { formatMod } from "../../rules/traits.ts";
import { Drawer } from "../../ui/Drawer.tsx";
import { FormMessage } from "../../ui/forms.tsx";
import { Inline, RichText, TermLink } from "../../ui/RichText.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { SaveIndicator } from "../builder/BuilderPage.tsx";
import { Features } from "../compendium/EntryView.tsx";

const TABS = [
  { id: "play", label: "Play" },
  { id: "cards", label: "Cards" },
  { id: "gear", label: "Gear" },
  { id: "features", label: "Features" },
  { id: "story", label: "Story" },
] as const;
type Tab = (typeof TABS)[number]["id"];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RANGE: Record<string, string> = { melee: "Melee", "very-close": "Very Close", close: "Close", far: "Far", "very-far": "Very Far" };

interface SheetCtx {
  c: CharacterDoc;
  d: Derived;
  reg: Registry;
  /** apply a rules function; RuleErrors and notes are shown to the player */
  act: (fn: (c: CharacterDoc) => CharacterDoc | Result) => void;
}

/** A number with a tap-to-open breakdown of where it comes from. */
function StatBox({ label, term, stat, value }: { label: string; term?: string; stat?: Stat; value?: string | number }) {
  return (
    <div className="statbox">
      <div className="statbox-label">{term ? <TermLink slug={term} label={label} /> : label}</div>
      <div className="statbox-value">{value ?? stat?.total}</div>
      {stat && stat.parts.length > 1 && (
        <details className="breakdown">
          <summary>How</summary>
          <ul>{stat.parts.map((p, i) => <li key={i}>{p.source}: {formatMod(p.value)}</li>)}{stat.capped && <li>Capped at the SRD maximum.</li>}</ul>
        </details>
      )}
    </div>
  );
}

/** Read-only box track; stage 6 makes these tappable. */
function Track({ label, term, marked, max, kind }: { label: string; term: string; marked: number; max: number; kind: string }) {
  return (
    <div className="track">
      <div className="track-label"><TermLink slug={term} label={label} /> <span className="hint">{kind === "hope" ? `${marked} of ${max}` : `${marked} of ${max} marked`}</span></div>
      <div className="boxes" role="img" aria-label={`${label}: ${marked} of ${max}${kind === "hope" ? "" : " marked"}`}>
        {Array.from({ length: max }, (_, i) => <span key={i} className={`box ${kind}${i < marked ? " on" : ""}`} />)}
      </div>
    </div>
  );
}

function weaponLine(w: EntryOf<"weapon">, d: Derived) {
  const dice = `${d.proficiency.total}${w.damage.dice}${w.damage.bonus ? `+${w.damage.bonus}` : ""}`;
  return `${w.trait === "spellcast" ? "Spellcast" : cap(w.trait)} ${formatMod(w.trait === "spellcast" ? Math.max(...d.spellcastTraits.map((t) => d.traits[t].total), 0) : d.traits[w.trait].total)} · ${RANGE[w.range]} · ${dice} ${w.damage.type} · ${w.burden === 1 ? "One-Handed" : "Two-Handed"}`;
}

function PlayTab({ c, d, reg, act }: SheetCtx) {
  const armor = reg.get(c.state.armorId, "armor");
  const [effect, setEffect] = useState("");
  const [until, setUntil] = useState<"" | "rest" | "long-rest">("");
  const vulnerable = stressVulnerable(c, d);
  return (
    <>
      <section aria-label="Core stats" className="statgrid">
        <StatBox label="Evasion" term="evasion" stat={d.evasion} />
        <StatBox label="Armor Score" term="armor-score" stat={d.armorScore} />
        <StatBox label="Proficiency" term="proficiency" stat={d.proficiency} />
        <div className="statbox thresholds">
          <div className="statbox-label"><TermLink slug="damage-thresholds" label="Damage thresholds" /></div>
          <div className="threshold-row">
            <span><small>Minor</small> 1–{d.thresholds.major.total - 1}</span>
            <span><small>Major</small> {d.thresholds.major.total}–{d.thresholds.severe.total - 1}</span>
            <span><small>Severe</small> {d.thresholds.severe.total}+</span>
          </div>
        </div>
      </section>

      <section aria-labelledby="traits-h">
        <h2 id="traits-h">Traits</h2>
        <div className="traitgrid">
          {TRAITS.map((t) => <StatBox key={t} label={cap(t)} term={t} stat={d.traits[t]} value={formatMod(d.traits[t].total)} />)}
        </div>
        {d.spellcastTraits.length > 0 && <p className="hint">Spellcast trait: {d.spellcastTraits.map(cap).join(" or ")}</p>}
      </section>

      <section aria-labelledby="track-h">
        <h2 id="track-h">Trackers</h2>
        <Track label="Hit Points" term="hit-points" marked={c.state.hpMarked} max={d.hpMax.total} kind="hp" />
        <Track label="Stress" term="stress" marked={c.state.stressMarked} max={d.stressMax.total} kind="stress" />
        <Track label="Hope" term="hope" marked={c.state.hope} max={d.hopeMax} kind="hope" />
        <Track label="Armor Slots" term="armor-slot" marked={c.state.armorMarked} max={d.armorScore.total} kind="armor" />
        <p className="hint">Tap-to-mark trackers, damage and dice arrive in stage 6.</p>
      </section>

      <section aria-labelledby="xp-h">
        <h2 id="xp-h"><TermLink slug="experience" label="Experiences" /></h2>
        <ul className="plain">{d.experiences.map((x) => <li key={x.id}>{x.name} <strong>{formatMod(x.bonus.total)}</strong></li>)}</ul>
      </section>

      <section aria-labelledby="weap-h">
        <h2 id="weap-h">Active weapons</h2>
        {[c.state.activePrimaryId, c.state.activeSecondaryId].filter(Boolean).length === 0 && <p>No active weapons.</p>}
        {[c.state.activePrimaryId, c.state.activeSecondaryId].map((id) => {
          const w = reg.get(id, "weapon");
          if (!w) return null;
          return (
            <div className="feature" key={w.id}>
              <h3><Link to={`/compendium/${w.id}`}>{w.name}</Link> <span className="kind">· {cap(w.category)}</span></h3>
              <p>{weaponLine(w, d)}</p>
              {w.feature && <p><strong>{w.feature.name}:</strong> <Inline text={w.feature.text} /></p>}
            </div>
          );
        })}
        <h2>Armor</h2>
        {armor ? (
          <div className="feature">
            <h3><Link to={`/compendium/${armor.id}`}>{armor.name}</Link></h3>
            <p>Base thresholds {armor.baseThresholds.major}/{armor.baseThresholds.severe} · Base score {armor.baseScore}</p>
            {armor.feature && <p><strong>{armor.feature.name}:</strong> <Inline text={armor.feature.text} /></p>}
          </div>
        ) : <p>Unarmored.</p>}
      </section>

      <section aria-labelledby="cond-h">
        <h2 id="cond-h"><TermLink slug="temporary" label="Conditions" /> and effects</h2>
        <div className="toggles">
          {reg.all("condition").map((cond) => {
            const on = c.state.conditions.includes(cond.id) || (cond.name === "Vulnerable" && vulnerable);
            const auto = cond.name === "Vulnerable" && vulnerable;
            return (
              <label key={cond.id} className="toggle">
                <input type="checkbox" checked={on} disabled={auto}
                  onChange={() => act((x) => { const s = x.state; s.conditions = s.conditions.includes(cond.id) ? s.conditions.filter((y) => y !== cond.id) : [...s.conditions, cond.id]; return x; })} />
                <TermLink slug={cond.name.toLowerCase()} label={cond.name} />
                {auto && <small> (all Stress marked)</small>}
              </label>
            );
          })}
        </div>
        <ul className="plain">
          {c.state.effects.map((e) => (
            <li key={e.id} className="toggle">
              <label><input type="checkbox" checked={e.on} onChange={() => act((x) => { const f = x.state.effects.find((y) => y.id === e.id)!; f.on = !f.on; return x; })} /> {e.label}</label>
              {e.until && <small className="hint"> until {e.until === "rest" ? "next rest" : "next long rest"}</small>}{" "}
              <button type="button" className="link" onClick={() => act((x) => ((x.state.effects = x.state.effects.filter((y) => y.id !== e.id)), x))}>Remove</button>
            </li>
          ))}
        </ul>
        <form className="inline-form" onSubmit={(ev) => { ev.preventDefault(); if (!effect.trim()) return; act((x) => ((x.state.effects = [...x.state.effects, { id: crypto.randomUUID(), label: effect.trim(), on: true, until: until || null }]), x)); setEffect(""); }}>
          <label htmlFor="new-effect" className="visually-hidden">New temporary effect</label>
          <input id="new-effect" placeholder="Add an effect (e.g. Rogue's Dodge +2 Evasion)" value={effect} maxLength={120} onChange={(e) => setEffect(e.target.value)} />
          <label htmlFor="effect-until" className="visually-hidden">Lasts until</label>
          <select id="effect-until" value={until} onChange={(e) => setUntil(e.target.value as typeof until)}>
            <option value="">No expiry</option><option value="rest">Until next rest</option><option value="long-rest">Until next long rest</option>
          </select>
          <button type="submit">Add</button>
        </form>
      </section>
    </>
  );
}

function CardsTab({ c, reg, act }: SheetCtx) {
  const [resting, setResting] = useState(false);
  const [swapOut, setSwapOut] = useState("");
  const full = c.state.loadout.length >= 5;
  const card = (id: string, where: "loadout" | "vault") => {
    const k = reg.get(id, "domain-card");
    if (!k) return <li key={id}>{id} (not available: is its pack on?)</li>;
    return (
      <li key={id} className="feature">
        <h3><Link to={`/compendium/${k.id}`}>{k.name}</Link> <span className="kind">· {reg.get(k.domainId)?.name} {k.level} · {cap(k.cardType)} · <TermLink slug="recall-cost" label="Recall" /> {k.recallCost}</span></h3>
        {k.text && <RichText text={k.text} headingBase={4} />}
        {k.features && <Features features={k.features} />}
        {where === "loadout" ? (
          <button type="button" onClick={() => act((x) => toVault(x, id))}>Move to vault</button>
        ) : (
          <button type="button" disabled={full && !swapOut} onClick={() => act((x) => fromVault(x, reg, id, { resting, swapOutId: full ? swapOut : undefined }))}>
            Move to loadout{!resting && k.recallCost > 0 ? ` (mark ${k.recallCost} Stress)` : ""}
          </button>
        )}
      </li>
    );
  };
  return (
    <>
      <label className="toggle"><input type="checkbox" checked={resting} onChange={(e) => setResting(e.target.checked)} /> Resting: swap cards for free (SRD p. 8)</label>
      <h2><TermLink slug="loadout" label="Loadout" /> ({c.state.loadout.length} of 5)</h2>
      <ul className="plain">{c.state.loadout.map((id) => card(id, "loadout"))}</ul>
      <h2><TermLink slug="vault" label="Vault" /> ({c.state.vault.length})</h2>
      {full && c.state.vault.length > 0 && (
        <div className="field">
          <label htmlFor="swap-out">Your loadout is full. Card to move to the vault in exchange:</label>
          <select id="swap-out" value={swapOut} onChange={(e) => setSwapOut(e.target.value)}>
            <option value="">Choose…</option>
            {c.state.loadout.map((id) => <option key={id} value={id}>{reg.get(id)?.name ?? id}</option>)}
          </select>
        </div>
      )}
      {c.state.vault.length === 0 ? <p className="hint">No cards in the vault.</p> : <ul className="plain">{c.state.vault.map((id) => card(id, "vault"))}</ul>}
    </>
  );
}

function GearTab({ c, d, reg, act }: SheetCtx) {
  const [calm, setCalm] = useState(true);
  const [newWeapon, setNewWeapon] = useState("");
  const [newItem, setNewItem] = useState("");
  const [newArmor, setNewArmor] = useState("");
  const consumable = (entryId?: string) => reg.get(entryId)?.type === "consumable";
  const addFromEntry = (val: string) => {
    const e = reg.byId.get(val);
    act((x) => {
      const existing = e ? x.state.inventory.find((i) => i.entryId === e.id) : undefined;
      if (existing) return setItemQty(x, reg, existing.id, existing.qty + 1);
      x.state.inventory.push({ id: crypto.randomUUID(), name: e?.name ?? val, ...(e ? { entryId: e.id } : {}), qty: 1, notes: "" });
      return x;
    });
  };
  return (
    <>
      <label className="toggle"><input type="checkbox" checked={calm} onChange={(e) => setCalm(e.target.checked)} /> Resting or a moment of calm (weapon swaps are free; armor can be changed)</label>

      <h2>Inventory weapons ({c.state.inventoryWeaponIds.length} of {INVENTORY_WEAPONS_MAX})</h2>
      <ul className="plain">
        {c.state.inventoryWeaponIds.map((id) => {
          const w = reg.get(id, "weapon");
          return (
            <li key={id} className="feature">
              <strong>{w?.name ?? id}</strong> {w && <span className="hint">{weaponLine(w, d)}</span>}{" "}
              <button type="button" onClick={() => act((x) => swapWeapon(x, reg, id, calm))}>Equip{calm ? "" : " (mark 1 Stress)"}</button>{" "}
              <button type="button" className="link" onClick={() => act((x) => ((x.state.inventoryWeaponIds = x.state.inventoryWeaponIds.filter((y) => y !== id)), x))}>Drop</button>
            </li>
          );
        })}
      </ul>
      {[c.state.activePrimaryId, c.state.activeSecondaryId].map((id, i) =>
        id ? (
          <p key={i}>
            Active: {reg.get(id)?.name}{" "}
            <button type="button" disabled={c.state.inventoryWeaponIds.length >= INVENTORY_WEAPONS_MAX}
              onClick={() => act((x) => { const s = x.state; s.inventoryWeaponIds.push(id); if (i === 0) s.activePrimaryId = null; else s.activeSecondaryId = null; return x; })}>
              Put away
            </button>
          </p>
        ) : null,
      )}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (!newWeapon) return; act((x) => { if (x.state.inventoryWeaponIds.length >= INVENTORY_WEAPONS_MAX) throw new RuleError(`You can carry only ${INVENTORY_WEAPONS_MAX} inventory weapons.`); x.state.inventoryWeaponIds.push(newWeapon); return x; }); setNewWeapon(""); }}>
        <label htmlFor="add-weapon" className="visually-hidden">Add a weapon</label>
        <select id="add-weapon" value={newWeapon} onChange={(e) => setNewWeapon(e.target.value)}>
          <option value="">Add a weapon…</option>
          {reg.all("weapon").filter((w) => w.tier <= d.tier).map((w) => <option key={w.id} value={w.id}>T{w.tier} {w.name} ({w.category})</option>)}
        </select>
        <button type="submit">Add</button>
      </form>

      <h2>Armor</h2>
      <p>{reg.get(c.state.armorId)?.name ?? "Unarmored"} · {c.state.armorMarked} of {d.armorScore.total} Armor Slots marked</p>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); act((x) => { if (!calm) throw new RuleError("You can't change armor while in danger or under pressure (SRD p. 55)."); x.state.armorId = newArmor || null; x.state.armorMarked = 0; return x; }); }}>
        <label htmlFor="armor-sel" className="visually-hidden">Change armor</label>
        <select id="armor-sel" value={newArmor} onChange={(e) => setNewArmor(e.target.value)}>
          <option value="">Unarmored</option>
          {reg.all("armor").filter((a) => a.tier <= d.tier).map((a) => <option key={a.id} value={a.id}>T{a.tier} {a.name}</option>)}
        </select>
        <button type="submit" disabled={!calm}>Equip</button>
      </form>
      <p className="hint">You can't carry armor in your inventory; changing armor replaces it (SRD p. 55).</p>

      <h2>Inventory</h2>
      <ul className="plain inventory">
        {c.state.inventory.map((it) => (
          <li key={it.id}>
            <span>{it.entryId ? <Link to={`/compendium/${it.entryId}`}>{it.name}</Link> : it.name}{consumable(it.entryId) && <small className="hint"> (max {CONSUMABLE_MAX})</small>}</span>
            <span className="counter">
              <button type="button" aria-label={`One fewer ${it.name}`} onClick={() => act((x) => setItemQty(x, reg, it.id, it.qty - 1))}>−</button>
              <span aria-label={`${it.name} quantity`}>{it.qty}</span>
              <button type="button" aria-label={`One more ${it.name}`} onClick={() => act((x) => setItemQty(x, reg, it.id, it.qty + 1))}>+</button>
            </span>
            <button type="button" className="link" onClick={() => act((x) => ((x.state.inventory = x.state.inventory.filter((y) => y.id !== it.id)), x))}>Remove</button>
          </li>
        ))}
      </ul>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (newItem.trim()) addFromEntry(newItem.trim()); setNewItem(""); }}>
        <label htmlFor="add-item" className="visually-hidden">Add an item</label>
        <input id="add-item" list="item-list" placeholder="Add an item (type or pick)" value={newItem} maxLength={120} onChange={(e) => setNewItem(e.target.value)} />
        <datalist id="item-list">{[...reg.all("consumable"), ...reg.all("item")].map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</datalist>
        <button type="submit">Add</button>
      </form>

      <h2>Gold</h2>
      <div className="gold">
        {(["handfuls", "bags", "chests"] as const).map((k) => (
          <div key={k} className="counter">
            <span>{cap(k)}</span>
            <button type="button" aria-label={`Spend one ${k.slice(0, -1)}`} onClick={() => act((x) => ((x.state.gold = addGold(x.state.gold, k, -1)), x))}>−</button>
            <strong aria-label={`${k}`}>{c.state.gold[k]}</strong>
            <button type="button" aria-label={`Gain one ${k.slice(0, -1)}`} onClick={() => act((x) => ((x.state.gold = addGold(x.state.gold, k, 1)), x))}>+</button>
          </div>
        ))}
      </div>
      <p className="hint">10 handfuls make a bag; 10 bags make a chest; you can hold 1 chest (SRD p. 84).</p>
    </>
  );
}

function FeaturesTab({ c, d }: SheetCtx) {
  const groups = new Map<string, typeof d.features>();
  for (const f of d.features) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);
  return (
    <>
      {[...groups].map(([source, fs]) => <Features key={source} title={source} features={fs.map((f) => f.feature)} />)}
      {c.build.classNotes && <><h2>Class notes</h2><p>{c.build.classNotes}</p></>}
    </>
  );
}

function StoryTab({ c, act }: SheetCtx) {
  const text = (id: string, label: string, value: string, set: (x: CharacterDoc, v: string) => void, rows = 3) => (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea id={id} rows={rows} value={value} maxLength={4000} onChange={(e) => act((x) => (set(x, e.target.value), x))} />
    </div>
  );
  return (
    <>
      {text("st-desc", "Description", c.identity.description, (x, v) => (x.identity.description = v))}
      <h2>Background</h2>
      {c.build.background.map((q, i) => text(`st-bg-${i}`, q.question, q.answer, (x, v) => (x.build.background[i].answer = v), 2))}
      {text("st-bgn", "Background notes", c.notes.background, (x, v) => (x.notes.background = v))}
      <h2>Connections</h2>
      {c.build.connections.map((q, i) => text(`st-cn-${i}`, q.question, q.answer, (x, v) => (x.build.connections[i].answer = v), 2))}
      {text("st-cnn", "Other connections", c.notes.connections, (x, v) => (x.notes.connections = v))}
      <h2>Session notes</h2>
      {text("st-notes", "Notes", c.notes.session, (x, v) => (x.notes.session = v), 8)}
    </>
  );
}

function RestDialog({ open, onClose, c, reg, act }: SheetCtx & { open: boolean; onClose: () => void }) {
  const forced = mustLongRest(c);
  const [kind, setKind] = useState<RestKind>(forced ? "long" : "short");
  const [moves, setMoves] = useState<(DowntimeMove | "")[]>(["", ""]);
  const k = forced ? "long" : kind;
  return (
    <Drawer open={open} onClose={onClose} title="Take a rest"
      footer={<button type="button" className="primary" onClick={() => { act((x) => takeRest(x, reg, k, moves.filter(Boolean) as DowntimeMove[])); setMoves(["", ""]); onClose(); }}>Take {k} rest</button>}>
      <p>Move domain cards between loadout and vault for free first (Cards tab, “Resting”). Then choose up to two downtime moves; the same one twice is fine (SRD p. 52).</p>
      <fieldset>
        <legend>Rest</legend>
        <label className="radio"><input type="radio" name="rest" checked={k === "short"} disabled={forced} onChange={() => setKind("short")} /> <TermLink slug="short-rest" label="Short rest" /> (about an hour)</label>
        <label className="radio"><input type="radio" name="rest" checked={k === "long"} onChange={() => setKind("long")} /> <TermLink slug="long-rest" label="Long rest" /> (several hours)</label>
        {forced && <p className="hint">You've taken three short rests in a row, so this one must be a long rest.</p>}
        <p className="hint">Short rests in a row: {c.state.rests?.shortInARow ?? 0}</p>
      </fieldset>
      {[0, 1].map((i) => (
        <div className="field" key={i}>
          <label htmlFor={`move-${i}`}>Downtime move {i + 1}</label>
          <select id={`move-${i}`} value={moves[i]} onChange={(e) => setMoves((m) => m.map((x, j) => (j === i ? (e.target.value as DowntimeMove) : x)))}>
            <option value="">None (or help an ally)</option>
            {DOWNTIME_MOVES[k].map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          </select>
        </div>
      ))}
      <p className="hint">The GM gains Fear when you rest.</p>
    </Drawer>
  );
}

export function SheetPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as Tab) || "play";
  const { registry: reg } = useContent();
  const { user } = useAuth();
  const [rec, update] = useCharacterRecord(id);
  const { status, error } = useAutosave(id, user?.id ?? null);
  const [notes, setNotes] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [resting, setResting] = useState(false);

  if (!rec) return <><h1>Character not found</h1><Link to="/characters">Your characters</Link></>;
  if (!rec.doc.finishedAt) return <Navigate to={`/build/${rec.doc.id}/review`} replace />;
  if (!reg) return <p role="status">Loading content…</p>;
  const c = rec.doc;
  const d = derive(c, reg);

  const act: SheetCtx["act"] = (fn) => {
    try {
      let out: string[] = [];
      update((x) => {
        const r = fn(x);
        if ("doc" in r && "notes" in r) {
          out = r.notes;
          return r.doc;
        }
        return r;
      });
      setNotes(out);
      setProblem(null);
    } catch (e) {
      if (e instanceof RuleError) {
        setProblem(e.message);
        setNotes([]);
      } else throw e;
    }
  };
  const ctx: SheetCtx = { c, d, reg, act };
  const name = (x: string | null) => (x ? reg.byId.get(x)?.name ?? x : "");
  const a = c.build.ancestry;
  const heritage = !a ? "" : a.kind === "single" ? name(a.id) : a.label || `${name(a.topFrom)}/${name(a.bottomFrom)}`;

  return (
    <div className="sheet">
      <header className="sheet-head">
        <div>
          <h1>{c.identity.name}</h1>
          <p className="hint">Level {d.level} {name(c.build.subclassId)} {name(c.build.classId)} · {heritage} · {name(c.build.communityId)}{c.identity.pronouns ? ` · ${c.identity.pronouns}` : ""}</p>
        </div>
        <SaveIndicator status={status} error={error} />
        <div className="sheet-actions">
          <button type="button" onClick={() => setResting(true)}>Rest</button>
          {d.level < MAX_LEVEL && <Link className="button" to={`/characters/${c.id}/level-up`}>Level up</Link>}
          <Link className="button" to={`/build/${c.id}/review`}>Edit build</Link>
          {c.levelUps.length > 0 && (
            <button type="button" onClick={() => confirm(`Undo the level ${d.level} level-up?`) && act((x) => undoLastLevelUp(x))}>Undo level-up</button>
          )}
        </div>
      </header>
      <FormMessage error={problem} info={notes.length ? notes.join(" ") : null} />
      <nav className="tabs" aria-label="Sheet sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" aria-current={tab === t.id ? "page" : undefined} onClick={() => setParams({ tab: t.id }, { replace: true })}>{t.label}</button>
        ))}
      </nav>
      <div className="tab-body">
        {tab === "play" && <PlayTab {...ctx} />}
        {tab === "cards" && <CardsTab {...ctx} />}
        {tab === "gear" && <GearTab {...ctx} />}
        {tab === "features" && <FeaturesTab {...ctx} />}
        {tab === "story" && <StoryTab {...ctx} />}
      </div>
      <RestDialog {...ctx} open={resting} onClose={() => setResting(false)} />
    </div>
  );
}
