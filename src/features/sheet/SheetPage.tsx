import { useState } from "react";
import { Link, Navigate, useParams, useSearchParams } from "react-router";
import { TRAITS, type EntryOf } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import type { Registry } from "../../content/registry.ts";
import { useAutosave, useCharacterRecord } from "../../data/characters.ts";
import type { CharacterDoc } from "../../rules/character.ts";
import { type Derived, derive, type Stat, subclassProgress } from "../../rules/derive.ts";
import { MAX_LEVEL, undoLastLevelUp } from "../../rules/levelup.ts";
import { addGold, CONSUMABLE_MAX, DOWNTIME_MOVES, type DowntimeMove, fromVault, INVENTORY_WEAPONS_MAX, mustLongRest, type RestKind, type Result, RuleError, setItemQty, stressVulnerable, swapWeapon, takeRest, toVault, equipWeapon, unequipWeapon } from "../../rules/sheet.ts";
import { formatMod } from "../../rules/traits.ts";
import { Drawer } from "../../ui/Drawer.tsx";
import { MoreMenu } from "../../ui/MoreMenu.tsx";
import { Meta } from "../../ui/Meta.tsx";
import { FormMessage } from "../../ui/forms.tsx";
import { Inline, RichText, TermLink } from "../../ui/RichText.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { ConflictPanel } from "../sync/ConflictPanel.tsx";
import { SaveIndicator } from "../builder/BuilderPage.tsx";
import { Features } from "../compendium/EntryView.tsx";
import { DamagePanel, Roller, type RollPreset, RollLog, TapTrack } from "./play.tsx";
import { BeastformPanel, CompanionPanel, ResourcesPanel, TokenCounter, UsedToggle } from "./extras.tsx";
import { ChoiceInput } from "../../ui/ChoiceInput.tsx";

const TABS = [
  { id: "play", label: "Play" },
  { id: "cards", label: "Cards" },
  { id: "gear", label: "Gear" },
  { id: "features", label: "Features" },
  { id: "story", label: "Story" },
  { id: "log", label: "Log" },
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
  remote: { userId: string | null; savedOnServer: boolean };
  roll: (p: RollPreset) => void;
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

function weaponLine(w: EntryOf<"weapon">, d: Derived) {
  const dice = `${d.proficiency.total}${w.damage.dice}${w.damage.bonus ? `+${w.damage.bonus}` : ""}`;
  const trait = `${w.trait === "spellcast" ? "Spellcast" : cap(w.trait)} ${formatMod(w.trait === "spellcast" ? Math.max(...d.spellcastTraits.map((t) => d.traits[t].total), 0) : d.traits[w.trait].total)}`;
  return <Meta items={[trait, RANGE[w.range], `${dice} ${w.damage.type}`, w.burden === 1 ? "One-Handed" : "Two-Handed"]} />;
}

function PlayTab(ctx: SheetCtx) {
  const { c, d, reg, act, roll } = ctx;
  const armor = reg.get(c.state.armorId, "armor");
  const [effect, setEffect] = useState("");
  const [until, setUntil] = useState<"" | "rest" | "long-rest">("");
  const vulnerable = stressVulnerable(c, d);
  const weapons = [c.state.activePrimaryId, c.state.activeSecondaryId].map((id) => reg.get(id, "weapon")).filter((x): x is NonNullable<typeof x> => !!x);
  return (
    <div className="play">
      <section aria-label="Defense" className="defense">
        <div className="statgrid">
          <StatBox label="Evasion" term="evasion" stat={d.evasion} />
          <StatBox label="Armor Score" term="armor-score" stat={d.armorScore} />
          <StatBox label="Proficiency" term="proficiency" stat={d.proficiency} />
        </div>
        <div className="statbox thresholds">
          <div className="statbox-label"><TermLink slug="damage-thresholds" label="Damage thresholds" /></div>
          <div className="threshold-row">
            <span><small>Minor</small> 1 to {d.thresholds.major.total - 1}</span>
            <span><small>Major</small> {d.thresholds.major.total} to {d.thresholds.severe.total - 1}</span>
            <span><small>Severe</small> {d.thresholds.severe.total}+</span>
          </div>
        </div>
      </section>

      <div className="play-rail">
        <div className="rail-dice">
          <button type="button" className="primary" onClick={() => roll({})}>Roll</button>
          <button type="button" onClick={() => roll({ reaction: true })}>Reaction</button>
        </div>
        <section aria-labelledby="track-h" className="trackers">
          <h2 id="track-h">Trackers</h2>
          {(["hp", "stress", "hope", "armor"] as const).map((k) => <TapTrack key={k} kind={k} {...ctx} />)}
        </section>
        <DamagePanel {...ctx} />
      </div>

      <div className="play-col play-col-b">
      <section aria-labelledby="weap-h">
        <h2 id="weap-h">Active weapons</h2>
        {d.beastform && <p className="msg msg-info">You’re in Beastform: you can’t use weapons until you drop out.</p>}
        {!c.state.activePrimaryId && !c.state.activeSecondaryId && d.features.some((f) => f.feature.name === "I Am the Weapon") && (
          <div className="attack">
            <div className="attack-head">
              <h3>Brawler’s Strike <span className="kind">(primary)</span></h3>
              <p><Meta items={[c.build.featureChoices["brawler-strike-trait"] ? cap(c.build.featureChoices["brawler-strike-trait"]) : "Trait of your choice", "Melee", `${d.proficiency.total}d8+${d.proficiency.total}d6 phy`, "+1 Evasion while active"]} /></p>
            </div>
            <button type="button" onClick={() => roll({ attack: "brawler" })} aria-label="Attack with Brawler’s Strike">Attack</button>
          </div>
        )}
        {weapons.length === 0 && !d.features.some((f) => f.feature.name === "I Am the Weapon") && <p>No active weapons.</p>}
        {weapons.map((w) => (
          <div className="attack" key={w.id}>
            <div className="attack-head">
              <h3><Link to={`/compendium/${w.id}`}>{w.name}</Link> <span className="kind">({w.category})</span></h3>
              <p>{weaponLine(w, d)}</p>
            </div>
            <button type="button" onClick={() => roll({ weaponId: w.id })} aria-label={`Attack with ${w.name}`}>Attack</button>
            {w.feature && <p className="attack-note"><strong>{w.feature.name}:</strong> <Inline text={w.feature.text} /></p>}
          </div>
        ))}
      </section>

      <section aria-labelledby="xp-h">
        <h2 id="xp-h"><TermLink slug="experience" label="Experiences" /></h2>
        <ul className="plain xp-list">
          {d.experiences.map((x) => (
            <li key={x.id} className="xp-row">
              <span className="xp-name">{x.name}</span> <strong className="xp-bonus">{formatMod(x.bonus.total)}</strong>
              <button type="button" className="roll-btn" disabled={c.state.hope < 1} onClick={() => roll({ experienceIds: [x.id] })} aria-label={`Roll with ${x.name} (spend a Hope)`}>Roll with</button>
            </li>
          ))}
        </ul>
      </section>
      <ResourcesPanel {...ctx} />
      <BeastformPanel {...ctx} onAttack={() => roll({ attack: "beastform" })} />
      <CompanionPanel {...ctx} onAttack={() => roll({ attack: "companion" })} />

      <section aria-labelledby="armor-h">
        <h2 id="armor-h">Armor</h2>
        {armor ? (
          <div className="attack">
            <div className="attack-head">
              <h3><Link to={`/compendium/${armor.id}`}>{armor.name}</Link></h3>
              <p><Meta items={[`Base thresholds ${armor.baseThresholds.major}/${armor.baseThresholds.severe}`, `Base score ${armor.baseScore}`]} /></p>
            </div>
            {armor.feature && <p className="attack-note"><strong>{armor.feature.name}:</strong> <Inline text={armor.feature.text} /></p>}
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
      </div>
      <div className="play-col play-col-a">
      <section aria-labelledby="traits-h">
        <h2 id="traits-h">Traits</h2>
        <div className="traitgrid">
          {TRAITS.map((t) => (
            <div key={t} className="trait-cell">
              <StatBox label={cap(t)} term={t} stat={d.traits[t]} value={formatMod(d.traits[t].total)} />
              <button type="button" className="roll-btn" onClick={() => roll({ trait: t })} aria-label={`Roll ${cap(t)} ${formatMod(d.traits[t].total)}`}>Roll</button>
            </div>
          ))}
        </div>
        {d.spellcastTraits.length > 0 && <p className="hint">Spellcast trait: {d.spellcastTraits.map(cap).join(" or ")}</p>}
      </section>
      <LoadoutQuick {...ctx} />


      </div>
    </div>
  );
}

/** A domain card's rules text and its table tools (used toggle, tokens, choices). Shared by the Cards tab and the play-tab pop-out. */
function CardBody({ k, c, d, act }: { k: EntryOf<"domain-card"> } & Pick<SheetCtx, "c" | "d" | "act">) {
  return (
    <>
      {k.text && <RichText text={k.text} headingBase={4} />}
      {k.features && <Features features={k.features} />}
      <div className="card-tools">
        <UsedToggle text={k.text + " " + (k.features ?? []).map((f) => f.text).join(" ")} name={k.name} c={c} act={act} />
        {/\btokens?\b/i.test(k.text) && <TokenCounter cardId={k.id} name={k.name} c={c} act={act} />}
      </div>
      {k.choices?.map((ch) => (
        <ChoiceInput key={ch.id} choice={ch} label={k.name} value={c.build.featureChoices[ch.id]} experiences={d.experiences.map((x) => ({ id: x.id, name: x.name }))}
          onChange={(v) => act((x) => ((x.build.featureChoices[ch.id] = v), x))} />
      ))}
    </>
  );
}

/** The loadout on the play tab: one line per card; tapping a card opens it in a drawer without leaving the tab. */
function LoadoutQuick({ c, d, reg, act }: SheetCtx) {
  const [openId, setOpenId] = useState<string | null>(null);
  const open = openId ? reg.get(openId, "domain-card") : undefined;
  return (
    <section aria-labelledby="loadout-h">
      <h2 id="loadout-h"><TermLink slug="loadout" label="Loadout" /> ({c.state.loadout.length} of {d.loadoutMax})</h2>
      {c.state.loadout.length === 0 ? (
        <p className="hint">No cards in your loadout. <Link to="?tab=cards">Open the Cards tab</Link> to add some.</p>
      ) : (
        <ul className="plain card-list">
          {c.state.loadout.map((id) => {
            const k = reg.get(id, "domain-card");
            if (!k) return <li key={id}>{id} (not available: is its pack on?)</li>;
            return (
              <li key={id}>
                <button type="button" className="card-open" onClick={() => setOpenId(id)} aria-haspopup="dialog">
                  <span className="card-title">{k.name}</span>
                  <Meta className="kind" items={[`${reg.get(k.domainId)?.name} ${k.level}`, cap(k.cardType)]} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <Drawer open={!!open} onClose={() => setOpenId(null)} title={open?.name ?? ""}
        footer={<Link className="button" to="?tab=cards" onClick={() => setOpenId(null)}>Manage cards</Link>}>
        {open && (
          <>
            <p className="hint"><Meta items={[`${reg.get(open.domainId)?.name} ${open.level}`, cap(open.cardType), <><TermLink slug="recall-cost" label="Recall" /> {open.recallCost}</>]} /></p>
            <CardBody k={open} c={c} d={d} act={act} />
          </>
        )}
      </Drawer>
    </section>
  );
}

function CardsTab({ c, d, reg, act }: SheetCtx) {
  const [resting, setResting] = useState(false);
  const [swapOut, setSwapOut] = useState("");
  const full = c.state.loadout.length >= d.loadoutMax;
  const card = (id: string, where: "loadout" | "vault") => {
    const k = reg.get(id, "domain-card");
    if (!k) return <li key={id}>{id} (not available: is its pack on?)</li>;
    return (
      <li key={id} className="feature">
        <h3><Link to={`/compendium/${k.id}`}>{k.name}</Link> <Meta className="kind" items={[`${reg.get(k.domainId)?.name} ${k.level}`, cap(k.cardType), <><TermLink slug="recall-cost" label="Recall" /> {k.recallCost}</>]} /></h3>
        <CardBody k={k} c={c} d={d} act={act} />
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
      <h2><TermLink slug="loadout" label="Loadout" /> ({c.state.loadout.length} of {d.loadoutMax})</h2>
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

/** One active-weapon slot: what's equipped, put it away, or equip another weapon of this category. */
function WeaponSlot({ slot, c, d, reg, act, calm }: Pick<SheetCtx, "c" | "d" | "reg" | "act"> & { slot: "primary" | "secondary"; calm: boolean }) {
  const [pick, setPick] = useState("");
  const id = slot === "primary" ? c.state.activePrimaryId : c.state.activeSecondaryId;
  const w = reg.get(id, "weapon");
  const other = reg.get(slot === "primary" ? c.state.activeSecondaryId : c.state.activePrimaryId, "weapon");
  const choice = reg.get(pick, "weapon");
  const owned = new Set(c.state.inventoryWeaponIds);
  const options = reg.all("weapon").filter((x) => x.category === slot && x.tier <= d.tier && x.id !== id).sort((a, b) => Number(owned.has(b.id)) - Number(owned.has(a.id)) || b.tier - a.tier || a.name.localeCompare(b.name));
  // warn when equipping would push the other weapon out (burden 2, p. 55)
  const pushesOut = !d.ignoresBurden && choice && other && ((slot === "primary" && choice.burden === 2) || (slot === "secondary" && other.burden === 2));
  const label = slot === "primary" ? "Primary" : "Secondary";
  return (
    <div className="feature weapon-slot">
      <h3>{label} weapon</h3>
      {w ? (
        <p>
          <strong>{w.name}</strong> <span className="hint">{weaponLine(w, d)}</span>{" "}
          <button type="button" className="link" disabled={c.state.inventoryWeaponIds.length >= INVENTORY_WEAPONS_MAX} onClick={() => act((x) => unequipWeapon(x, slot))}>Put away</button>
        </p>
      ) : (
        <p className="hint">None equipped.</p>
      )}
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (!pick) return; act((x) => equipWeapon(x, reg, pick, calm)); setPick(""); }}>
        <label htmlFor={`equip-${slot}`} className="visually-hidden">Equip a {slot} weapon</label>
        <select id={`equip-${slot}`} value={pick} onChange={(e) => setPick(e.target.value)}>
          <option value="">{w ? `Change ${slot} weapon…` : `Equip a ${slot} weapon…`}</option>
          {options.map((x) => <option key={x.id} value={x.id}>{owned.has(x.id) ? "★ " : ""}T{x.tier} {x.name}{x.burden === 2 ? " (two-handed)" : ""}{owned.has(x.id) ? " (in inventory)" : ""}</option>)}
        </select>
        <button type="submit" disabled={!pick}>Equip{calm ? "" : " (mark 1 Stress)"}</button>
      </form>
      {pushesOut && <p className="hint">Equipping {choice.name} moves {other.name} to your inventory: you only have two hands.</p>}
    </div>
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

      <h2>Active weapons</h2>
      <p className="hint">
        {d.ignoresBurden
          ? "Combat Training: you ignore burden, so a two-handed primary and a secondary can both be active."
          : `Hands in use: ${[c.state.activePrimaryId, c.state.activeSecondaryId].reduce((n, id) => n + (reg.get(id, "weapon")?.burden ?? 0), 0)} of 2 (SRD p. 55).`}
      </p>
      <WeaponSlot slot="primary" c={c} d={d} reg={reg} act={act} calm={calm} />
      <WeaponSlot slot="secondary" c={c} d={d} reg={reg} act={act} calm={calm} />

      <h2>Inventory weapons ({c.state.inventoryWeaponIds.length} of {INVENTORY_WEAPONS_MAX})</h2>
      {c.state.inventoryWeaponIds.length === 0 && <p className="hint">No spare weapons.</p>}
      <ul className="plain">
        {c.state.inventoryWeaponIds.map((id) => {
          const w = reg.get(id, "weapon");
          return (
            <li key={id} className="feature">
              <strong>{w?.name ?? id}</strong> {w && <span className="kind">({w.category})</span>} {w && <span className="hint">{weaponLine(w, d)}</span>}{" "}
              <button type="button" onClick={() => act((x) => swapWeapon(x, reg, id, calm))}>Equip as {w?.category ?? "weapon"}{calm ? "" : " (mark 1 Stress)"}</button>{" "}
              <button type="button" className="link" onClick={() => act((x) => ((x.state.inventoryWeaponIds = x.state.inventoryWeaponIds.filter((y) => y !== id)), x))}>Drop</button>
            </li>
          );
        })}
      </ul>
      <form className="inline-form" onSubmit={(e) => { e.preventDefault(); if (!newWeapon) return; act((x) => { if (x.state.inventoryWeaponIds.length >= INVENTORY_WEAPONS_MAX) throw new RuleError(`You can carry only ${INVENTORY_WEAPONS_MAX} inventory weapons.`); x.state.inventoryWeaponIds.push(newWeapon); return x; }); setNewWeapon(""); }}>
        <label htmlFor="add-weapon" className="visually-hidden">Carry a spare weapon</label>
        <select id="add-weapon" value={newWeapon} onChange={(e) => setNewWeapon(e.target.value)}>
          <option value="">Carry a spare weapon…</option>
          {reg.all("weapon").filter((w) => w.tier <= d.tier).map((w) => <option key={w.id} value={w.id}>T{w.tier} {w.name} ({w.category})</option>)}
        </select>
        <button type="submit">Add to inventory</button>
      </form>

      <h2>Armor</h2>
      <p>{reg.get(c.state.armorId)?.name ?? "Unarmored"}: {c.state.armorMarked} of {d.armorScore.total} Armor Slots marked</p>
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

const STAGE_LABEL = { foundation: "Foundation", specialization: "Specialization", mastery: "Mastery" } as const;

/** One feature with its "Used" checkbox and any choices it asks for. */
function FeatureItem({ f, source, c, d, act }: { f: import("../../../content/schema/index.ts").Feature; source: string } & Pick<SheetCtx, "c" | "d" | "act">) {
  return (
    <div>
      <Features features={[f]} />
      <UsedToggle text={f.text} name={`${source}: ${f.name}`} c={c} act={act} />
      {f.choices?.map((ch) => (
        <ChoiceInput key={ch.id} choice={ch} label={f.name} value={c.build.featureChoices[ch.id]} experiences={d.experiences.map((x) => ({ id: x.id, name: x.name }))}
          onChange={(v) => act((x) => ((x.build.featureChoices[ch.id] = v), x))} />
      ))}
    </div>
  );
}

/** Foundation → Specialization → Mastery, with what's unlocked, when, and what's next (SRD p. 9, 54). */
function SubclassTrack({ c, d, reg, act }: SheetCtx) {
  return (
    <>
      {subclassProgress(c, reg).map((p) => (
        <section key={p.subclass.id} className="subclass-track" aria-labelledby={`sc-${p.subclass.id}`}>
          <h2 id={`sc-${p.subclass.id}`}>
            <Link to={`/compendium/${p.subclass.id}`}>{p.subclass.name}</Link> <span className="kind">({p.multiclass ? "multiclass subclass" : "subclass"})</span>
          </h2>
          <ol className="stages">
            {p.cards.map((card) => (
              <li key={card.stage} className={card.acquired ? "acquired" : "locked"}>
                <h3>
                  <span aria-hidden="true">{card.acquired ? "✓" : "○"}</span> {STAGE_LABEL[card.stage]}
                  <span className="kind"> ({card.acquired ? (card.level ? `level ${card.level}` : "acquired") : "not yet"})</span>
                </h3>
                {card.acquired ? (
                  card.features.map((f) => <FeatureItem key={f.name} f={f} source={`${p.subclass.name} (${card.stage})`} c={c} d={d} act={act} />)
                ) : (
                  <>
                    <p className="hint">
                      {p.multiclass
                        ? "Only your main subclass takes upgraded cards (SRD p. 54)."
                        : p.next?.stage === card.stage
                          ? p.next.hint
                          : `Comes after the ${STAGE_LABEL[p.next?.stage ?? "specialization"].toLowerCase()}.`}
                    </p>
                    <details>
                      <summary>Preview: {card.features.map((f) => f.name).join(", ")}</summary>
                      <div className="preview"><Features features={card.features} /></div>
                    </details>
                  </>
                )}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </>
  );
}

function FeaturesTab(ctx: SheetCtx) {
  const { c, d, act } = ctx;
  const groups = new Map<string, typeof d.features>();
  // subclass features are shown in the track above, in order
  for (const f of d.features) if (!/ \((foundation|specialization|mastery)\)$/.test(f.source)) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);
  return (
    <>
      <SubclassTrack {...ctx} />
      {[...groups].map(([source, fs]) => (
        <section key={source}>
          <h2>{source}</h2>
          {fs.map(({ feature: f }) => <FeatureItem key={f.name} f={f} source={source} c={c} d={d} act={act} />)}
        </section>
      ))}
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
        {forced && <p className="hint">You’ve taken three short rests in a row, so this one must be a long rest.</p>}
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
  const { status, error, resolve } = useAutosave(id, user?.id ?? null);
  const [preset, setPreset] = useState<RollPreset | null>(null);
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
  const ctx: SheetCtx = { c, d, reg, act, remote: { userId: user?.id ?? null, savedOnServer: rec.rev > 0 }, roll: setPreset };
  const name = (x: string | null) => (x ? reg.byId.get(x)?.name ?? x : "");
  const a = c.build.ancestry;
  const heritage = !a ? "" : a.kind === "single" ? name(a.id) : a.label || `${name(a.topFrom)}/${name(a.bottomFrom)}`;

  return (
    <div className="sheet">
      <header className="sheet-head">
        <div className="sheet-id">
          <h1>{c.identity.name}</h1>
          <p className="sheet-meta"><Meta items={[`Level ${d.level} ${name(c.build.subclassId)} ${name(c.build.classId)}`, heritage, name(c.build.communityId), c.identity.pronouns]} /></p>
        <p className="subclass-summary">
          {subclassProgress(c, reg).map((p) => (
            <span key={p.subclass.id}>
              {p.subclass.name}: <Meta items={p.cards.map((card) => `${STAGE_LABEL[card.stage]}${card.acquired ? " ✓" : ""}`)} />{" "}
              <button type="button" className="link" onClick={() => setParams({ tab: "features" }, { replace: true })}>Details</button>
            </span>
          ))}
        </p>
        <SaveIndicator status={status} error={error} />
        </div>
        <div className="sheet-actions">
          <button type="button" onClick={() => setResting(true)}>Rest</button>
          {d.level < MAX_LEVEL && <Link className="button" to={`/characters/${c.id}/level-up`}>Level up</Link>}
          <MoreMenu>
            <Link to={`/build/${c.id}/review`}>Edit build</Link>
            <Link to={`/characters/${c.id}/history`}>History</Link>
            <Link to={`/characters/${c.id}/print`}>Print / PDF</Link>
            {c.levelUps.length > 0 && (
              <button type="button" className="menu-danger" onClick={() => confirm(`Undo the level ${d.level} level-up?`) && act((x) => undoLastLevelUp(x))}>Undo level {d.level}</button>
            )}
          </MoreMenu>
        </div>
      </header>
      <ConflictPanel rec={rec} reg={reg} resolve={resolve} />
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
        {tab === "log" && <RollLog c={c} d={d} act={act} />}
      </div>
      <RestDialog {...ctx} open={resting} onClose={() => setResting(false)} />
      {preset && <Roller key={JSON.stringify(preset)} {...ctx} preset={preset} onClose={() => setPreset(null)} />}
      <div className="fab">
        <button type="button" className="primary" onClick={() => setPreset({})}>Roll</button>
        <button type="button" onClick={() => setPreset({ reaction: true })}>Reaction</button>
      </div>
    </div>
  );
}
