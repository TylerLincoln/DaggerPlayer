import { useEffect } from "react";
import { Link, useParams } from "react-router";
import { TRAITS } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import { bundledPacks } from "../../content/packs.ts";
import { useCharacterRecord } from "../../data/characters.ts";
import { derive } from "../../rules/derive.ts";
import { formatMod } from "../../rules/traits.ts";
import { Inline, RichText } from "../../ui/RichText.tsx";

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const RANGE: Record<string, string> = { melee: "Melee", "very-close": "Very Close", close: "Close", far: "Far", "very-far": "Very Far" };

function Boxes({ label, marked, max, round }: { label: string; marked: number; max: number; round?: boolean }) {
  return (
    <div className="p-track">
      <span className="p-track-label">{label}</span>
      <span className="p-boxes" aria-label={`${label}: ${marked} of ${max}`}>
        {Array.from({ length: max }, (_, i) => <span key={i} className={`p-box${round ? " round" : ""}${i < marked ? " on" : ""}`} />)}
      </span>
      <span className="p-count">{marked}/{max}</span>
    </div>
  );
}

/** Printable character sheet: use the browser's Print → Save as PDF (decision D10). */
export function PrintPage() {
  const { id } = useParams();
  const { registry: reg } = useContent();
  const [rec] = useCharacterRecord(id);

  useEffect(() => {
    if (!rec) return;
    const prev = document.title;
    document.title = `${rec.doc.identity.name || "Character"} – DaggerPlayer`; // becomes the PDF file name
    return () => void (document.title = prev);
  }, [rec]);

  if (!rec) return <><h1>Character not found</h1><Link to="/characters">Your characters</Link></>;
  if (!reg) return <p role="status">Loading content…</p>;
  const c = rec.doc;
  const d = derive(c, reg);
  const name = (x: string | null) => (x ? reg.byId.get(x)?.name ?? x : "—");
  const a = c.build.ancestry;
  const heritage = !a ? "—" : a.kind === "single" ? name(a.id) : `${a.label || "Mixed"} (${name(a.topFrom)} / ${name(a.bottomFrom)})`;
  const srd = bundledPacks.find((p) => p.id === "srd");
  const weapons = [c.state.activePrimaryId, c.state.activeSecondaryId].map((x) => reg.get(x, "weapon")).filter((w) => !!w);
  const armor = reg.get(c.state.armorId, "armor");
  const groups = new Map<string, typeof d.features>();
  for (const f of d.features) groups.set(f.source, [...(groups.get(f.source) ?? []), f]);
  const card = (cid: string) => reg.get(cid, "domain-card");

  return (
    <div className="print-page">
      <div className="print-toolbar no-print">
        <button type="button" className="primary" onClick={() => window.print()}>Print / Save as PDF</button>{" "}
        <Link to={`/characters/${c.id}`}>Back to the sheet</Link>
        <p className="hint">In the print dialog choose “Save as PDF” as the destination. Turn on “Background graphics” to print marked boxes as filled.</p>
      </div>

      <article className="print-sheet" aria-label={`Character sheet: ${c.identity.name}`}>
        <header className="p-head">
          <div>
            <h1>{c.identity.name || "Unnamed character"}</h1>
            <p>{c.identity.pronouns && `${c.identity.pronouns} · `}Level {d.level} {name(c.build.subclassId)} {name(c.build.classId)}</p>
            <p>{heritage} · {name(c.build.communityId)}{c.build.transformationId ? ` · ${name(c.build.transformationId)}` : ""}</p>
          </div>
          <dl className="p-core">
            <div><dt>Evasion</dt><dd>{d.evasion.total}</dd></div>
            <div><dt>Armor Score</dt><dd>{d.armorScore.total}</dd></div>
            <div><dt>Proficiency</dt><dd>{d.proficiency.total}</dd></div>
            <div><dt>Tier</dt><dd>{d.tier}</dd></div>
          </dl>
        </header>

        <section className="p-grid">
          <div>
            <h2>Damage thresholds</h2>
            <p className="p-thresholds"><span>Minor 1–{d.thresholds.major.total - 1}</span> <span>Major {d.thresholds.major.total}–{d.thresholds.severe.total - 1}</span> <span>Severe {d.thresholds.severe.total}+</span></p>
            <Boxes label="Hit Points" marked={c.state.hpMarked} max={d.hpMax.total} />
            <Boxes label="Stress" marked={c.state.stressMarked} max={d.stressMax.total} />
            <Boxes label="Hope" marked={c.state.hope} max={d.hopeMax} round />
            <Boxes label="Armor Slots" marked={c.state.armorMarked} max={d.armorScore.total} />
          </div>
          <div>
            <h2>Traits</h2>
            <dl className="p-traits">
              {TRAITS.map((t) => <div key={t}><dt>{cap(t)}</dt><dd>{formatMod(d.traits[t].total)}</dd></div>)}
            </dl>
            {d.spellcastTraits.length > 0 && <p>Spellcast trait: {d.spellcastTraits.map(cap).join(" or ")}</p>}
            <h2>Experiences</h2>
            <ul>{d.experiences.map((x) => <li key={x.id}>{x.name} {formatMod(x.bonus.total)}</li>)}</ul>
          </div>
        </section>

        <section>
          <h2>Weapons and armor</h2>
          <table className="p-table">
            <thead><tr><th scope="col">Weapon</th><th scope="col">Trait</th><th scope="col">Range</th><th scope="col">Damage</th><th scope="col">Feature</th></tr></thead>
            <tbody>
              {weapons.map((w) => (
                <tr key={w!.id}>
                  <td>{w!.name}{w!.burden === 2 ? " (two-handed)" : ""}</td>
                  <td>{w!.trait === "spellcast" ? "Spellcast" : cap(w!.trait)}</td>
                  <td>{RANGE[w!.range]}</td>
                  <td>{d.proficiency.total}{w!.damage.dice}{w!.damage.bonus ? `+${w!.damage.bonus}` : ""} {w!.damage.type}</td>
                  <td>{w!.feature ? <><strong>{w!.feature.name}:</strong> <Inline text={w!.feature.text} links={false} /></> : "—"}</td>
                </tr>
              ))}
              {weapons.length === 0 && <tr><td colSpan={5}>No active weapons.</td></tr>}
            </tbody>
          </table>
          <p>
            <strong>Armor:</strong> {armor ? <>{armor.name} (base thresholds {armor.baseThresholds.major}/{armor.baseThresholds.severe}, base score {armor.baseScore}){armor.feature && <> · <strong>{armor.feature.name}:</strong> <Inline text={armor.feature.text} links={false} /></>}</> : "Unarmored"}
          </p>
          {c.state.inventoryWeaponIds.length > 0 && <p><strong>Inventory weapons:</strong> {c.state.inventoryWeaponIds.map(name).join(", ")}</p>}
        </section>

        <section className="p-grid">
          <div>
            <h2>Inventory</h2>
            <ul>{c.state.inventory.map((i) => <li key={i.id}>{i.name}{i.qty !== 1 ? ` ×${i.qty}` : ""}{i.notes ? ` (${i.notes})` : ""}</li>)}</ul>
          </div>
          <div>
            <h2>Gold</h2>
            <p>{c.state.gold.handfuls} handfuls · {c.state.gold.bags} bags · {c.state.gold.chests} chests</p>
            {(c.state.conditions.length > 0 || c.state.effects.length > 0) && (
              <>
                <h2>Conditions and effects</h2>
                <p>{[...c.state.conditions.map(name), ...c.state.effects.filter((e) => e.on).map((e) => e.label)].join(", ")}</p>
              </>
            )}
          </div>
        </section>

        <section>
          <h2>Domain cards</h2>
          {[["Loadout", c.state.loadout], ["Vault", c.state.vault]].map(([title, ids]) =>
            (ids as string[]).length ? (
              <div key={title as string}>
                <h3>{title as string}</h3>
                {(ids as string[]).map((cid) => {
                  const k = card(cid);
                  if (!k) return <p key={cid}>{cid}</p>;
                  return (
                    <div className="p-card" key={cid}>
                      <h4>{k.name} <small>{name(k.domainId)} {k.level} · {cap(k.cardType)} · Recall {k.recallCost}</small></h4>
                      {k.text && <PrintText text={k.text} />}
                      {k.features?.map((f) => <p key={f.name}><strong>{f.name}:</strong> <Inline text={f.text} links={false} /></p>)}
                    </div>
                  );
                })}
              </div>
            ) : null,
          )}
        </section>

        <section>
          <h2>Features</h2>
          {[...groups].map(([source, fs]) => (
            <div key={source} className="p-card">
              <h4>{source}</h4>
              {fs.map(({ feature: f }) => (
                <div key={f.name}>
                  <p><strong>{f.name}{f.kind ? ` (${f.kind})` : ""}:</strong></p>
                  <PrintText text={f.text} />
                </div>
              ))}
            </div>
          ))}
          {c.build.classNotes && <p><strong>Class notes:</strong> {c.build.classNotes}</p>}
        </section>

        <section className="p-story">
          <h2>Background</h2>
          {c.identity.description && <p>{c.identity.description}</p>}
          {c.build.background.filter((q) => q.answer.trim()).map((q, i) => <p key={i}><strong><Inline text={q.question} links={false} /></strong> {q.answer}</p>)}
          {c.notes.background && <p>{c.notes.background}</p>}
          <h2>Connections</h2>
          {c.build.connections.filter((q) => q.answer.trim()).map((q, i) => <p key={i}><strong><Inline text={q.question} links={false} /></strong> {q.answer}</p>)}
          {c.notes.connections && <p>{c.notes.connections}</p>}
          {c.notes.session && <><h2>Notes</h2><p className="p-pre">{c.notes.session}</p></>}
        </section>

        <footer className="p-attribution">
          <p>{srd?.attribution}</p>
          <p>Modifications: {srd?.modifications.join(" ")} DaggerPlayer is a Daggerheart™ Compatible tool, not affiliated with or endorsed by Darrington Press or Critical Role. License: https://darringtonpress.com/license/</p>
          <p>Printed {new Date().toLocaleDateString()} from DaggerPlayer.</p>
        </footer>
      </article>
    </div>
  );
}

/** Rich text for paper: same layout, rules terms as plain words (no links or tooltips). */
function PrintText({ text }: { text: string }) {
  return <div className="p-text"><RichText text={text.replace(/\{\{(?:term|ref):[^|}]+\|([^}]+)\}\}/g, "$1").replace(/\{\{(?:term|ref):([^|}]+)\}\}/g, "$1")} headingBase={5} /></div>;
}
