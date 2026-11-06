import type { ReactNode } from "react";
import { Link, Navigate } from "react-router";
import type { Entry, EntryOf, Feature } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import { entryPath, sourceLabel, TYPE_LABELS } from "../../content/registry.ts";
import { DomainIcon } from "../../ui/DomainIcon.tsx";
import { Inline, RichText } from "../../ui/RichText.tsx";

const RANGE: Record<string, string> = { melee: "Melee", "very-close": "Very Close", close: "Close", far: "Far", "very-far": "Very Far" };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const signed = (n: number) => (n >= 0 ? `+${n}` : `−${-n}`);

function Stats({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="stats">
      {items
        .filter(([, v]) => v !== null && v !== undefined && v !== "")
        .map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
    </dl>
  );
}

export function Features({ features, title }: { features: Feature[]; title?: string }) {
  if (!features.length) return null;
  return (
    <section>
      {title && <h2>{title}</h2>}
      {features.map((f, i) => (
        <div className="feature" key={i}>
          <h3>
            {f.name}
            {f.kind && <span className="kind"> · {cap(f.kind)}</span>}
          </h3>
          <RichText text={f.text} headingBase={4} />
          {f.questions?.length ? (
            <ul className="gm-questions" aria-label="GM questions">
              {f.questions.map((q, j) => <li key={j}><em>{q}</em></li>)}
            </ul>
          ) : null}
        </div>
      ))}
    </section>
  );
}

function EntryLink({ id }: { id: string }) {
  const { registry } = useContent();
  const e = registry?.byId.get(id);
  if (!e) return <span>{id}</span>;
  return (
    <Link to={entryPath(e)}>
      {e.type === "domain" && <DomainIcon pack={e.pack} icon={e.icon} size={18} />} {e.name}
    </Link>
  );
}

const links = (ids: string[]) => ids.map((id, i) => <span key={id}>{i > 0 && ", "}<EntryLink id={id} /></span>);

function ClassView({ e }: { e: EntryOf<"class"> }) {
  const { registry } = useContent();
  return (
    <>
      <RichText text={e.text} />
      <Stats items={[["Domains", links(e.domainIds)], ["Starting Evasion", e.startingEvasion], ["Starting Hit Points", e.startingHp], ["Class items", e.classItems.join(" or ")]]} />
      <Features title="Hope feature" features={[e.hopeFeature]} />
      <Features title="Class features" features={e.classFeatures} />
      {e.lists?.map((l) => (
        <section key={l.title}>
          <h2>{l.title}</h2>
          <p>{l.items.join(", ")}</p>
        </section>
      ))}
      <section>
        <h2>Subclasses</h2>
        <ul>
          {e.subclassIds.map((id) => {
            const s = registry?.get(id, "subclass");
            return (
              <li key={id}>
                <EntryLink id={id} />
                {s?.spellcastTrait && <> · Spellcast trait: {cap(s.spellcastTrait)}</>}
              </li>
            );
          })}
        </ul>
      </section>
      <section>
        <h2>Background questions</h2>
        <ul>{e.backgroundQuestions.map((q, i) => <li key={i}><Inline text={q} /></li>)}</ul>
        <h2>Connections</h2>
        <ul>{e.connectionQuestions.map((q, i) => <li key={i}><Inline text={q} /></li>)}</ul>
      </section>
    </>
  );
}

function SubclassView({ e }: { e: EntryOf<"subclass"> }) {
  return (
    <>
      <Stats items={[["Class", <EntryLink id={e.classId} />], ["Spellcast trait", e.spellcastTrait ? cap(e.spellcastTrait) : "None"]]} />
      <RichText text={e.text} />
      <Features title="Foundation" features={e.foundation} />
      <Features title="Specialization" features={e.specialization} />
      <Features title="Mastery" features={e.mastery} />
    </>
  );
}

function DomainView({ e }: { e: EntryOf<"domain"> }) {
  const { registry } = useContent();
  const cards = (registry?.childrenOf(e.id) ?? []) as EntryOf<"domain-card">[];
  return (
    <>
      <RichText text={e.text} />
      <Stats items={[["Classes", links(registry?.classesWithDomain(e.id).map((c) => c.id) ?? [])]]} />
      <h2>Cards</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Level</th><th scope="col">Card</th><th scope="col">Type</th><th scope="col">Recall</th></tr></thead>
          <tbody>
            {cards.map((c) => (
              <tr key={c.id}><td>{c.level}</td><td><Link to={entryPath(c)}>{c.name}</Link></td><td>{cap(c.cardType)}</td><td>{c.recallCost}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function DomainCardView({ e }: { e: EntryOf<"domain-card"> }) {
  const { registry } = useContent();
  return (
    <>
      <Stats
        items={[
          ["Domain", <EntryLink id={e.domainId} />],
          ["Level", e.level],
          ["Type", cap(e.cardType)],
          ["Recall cost", e.recallCost],
          ["Classes", links(registry?.classesWithDomain(e.domainId).map((c) => c.id) ?? [])],
        ]}
      />
      {e.text && <RichText text={e.text} />}
      {e.features && <Features features={e.features} />}
    </>
  );
}

function AncestryView({ e }: { e: EntryOf<"ancestry"> }) {
  const { registry } = useContent();
  const mixed = registry?.all("rules").find((r) => r.name === "Mixed Ancestry");
  return (
    <>
      <RichText text={e.text} />
      <Features title="Ancestry features" features={e.features} />
      <p className="hint">
        For a mixed ancestry, the first feature ({e.features[0].name}) is the top feature and the second ({e.features[1].name}) the bottom.
        {mixed && <> See <Link to={entryPath(mixed)}>Mixed Ancestry</Link>.</>}
      </p>
    </>
  );
}

function WeaponView({ e }: { e: EntryOf<"weapon"> }) {
  const dmg = `${e.damage.dice}${e.damage.bonus ? `+${e.damage.bonus}` : ""} ${e.damage.type}`;
  return (
    <>
      <Stats
        items={[
          ["Tier", e.tier],
          ["Category", `${cap(e.category)} · ${e.group === "combat-wheelchair" ? "Combat wheelchair" : cap(e.group)}`],
          ["Trait", e.trait === "spellcast" ? "Spellcast" : cap(e.trait)],
          ["Range", RANGE[e.range]],
          ["Damage", dmg],
          ["Burden", e.burden === 1 ? "One-Handed" : "Two-Handed"],
        ]}
      />
      {e.feature ? <Features title="Feature" features={[e.feature]} /> : <p>No feature.</p>}
    </>
  );
}

function ArmorView({ e }: { e: EntryOf<"armor"> }) {
  return (
    <>
      <Stats items={[["Tier", e.tier], ["Base thresholds", `${e.baseThresholds.major} / ${e.baseThresholds.severe}`], ["Base Armor Score", e.baseScore]]} />
      {e.feature ? <Features title="Feature" features={[e.feature]} /> : <p>No feature.</p>}
    </>
  );
}

function BeastformView({ e }: { e: EntryOf<"beastform"> }) {
  return (
    <>
      <Stats
        items={[
          ["Tier", e.tier],
          ["Examples", e.examples],
          ["Trait", e.traitBonus ? `${cap(e.traitBonus.trait)} ${signed(e.traitBonus.value)}` : null],
          ["Evasion", e.evasionBonus !== null ? signed(e.evasionBonus) : null],
          ["Attack", e.attack ? `${RANGE[e.attack.range]} · ${cap(e.attack.trait)} · ${e.attack.damage} ${e.attack.damageType}` : null],
          ["Advantage on", e.advantages.join(", ")],
        ]}
      />
      <Features title="Features" features={e.features} />
    </>
  );
}

function AdversaryView({ e }: { e: EntryOf<"adversary"> }) {
  const th = e.thresholds ? `${e.thresholds.major ?? "None"} / ${e.thresholds.severe ?? "None"}` : "None";
  return (
    <div className="statblock">
      <p className="tagline"><em>Tier {e.tier} {cap(e.role)}{e.hordePerHp ? ` (${e.hordePerHp}/HP)` : ""}</em></p>
      <RichText text={e.text} />
      <Stats
        items={[
          ["Motives & tactics", e.motives],
          ["Difficulty", e.difficulty],
          ["Thresholds", th],
          ["HP", e.hp ?? "None"],
          ["Stress", e.stress ?? "None"],
          ["Attack", `${e.attack.modifier} · ${e.attack.name}: ${RANGE[e.attack.range]} · ${e.attack.damage}`],
          ["Experience", e.experiences.map((x) => `${x.name} ${signed(x.bonus)}`).join(", ")],
        ]}
      />
      <Features title="Features" features={e.features} />
    </div>
  );
}

function EnvironmentView({ e }: { e: EntryOf<"environment"> }) {
  return (
    <div className="statblock">
      <p className="tagline"><em>Tier {e.tier} {cap(e.envType)}</em></p>
      <RichText text={e.text} />
      <Stats items={[["Impulses", e.impulses], ["Difficulty", e.difficulty ?? e.difficultyNote], ["Potential adversaries", e.potentialAdversaries]]} />
      <Features title="Features" features={e.features} />
    </div>
  );
}

function ProgressionView({ e }: { e: EntryOf<"progression"> }) {
  return (
    <>
      <RichText text={e.text} />
      <h2>Tier achievements</h2>
      <ul>{e.tiers.filter((t) => t.achievements).map((t) => <li key={t.tier}><Inline text={t.achievements!} /></li>)}</ul>
      <h2>Advancements</h2>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col">Option</th><th scope="col">Tier 2</th><th scope="col">Tier 3</th><th scope="col">Tier 4</th></tr></thead>
          <tbody>
            {e.advancements.map((a) => (
              <tr key={a.id}>
                <td><Inline text={a.text} />{a.cost === 2 && <> <strong>(uses 2 slots)</strong></>}</td>
                {(["2", "3", "4"] as const).map((t) => <td key={t}>{a.slotsByTier[t] ?? "—"}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="hint">{e.slotsSource}</p>
      <Features title="Ranger companion options" features={e.companionOptions} />
    </>
  );
}

function GlossaryView({ e }: { e: EntryOf<"glossary"> }) {
  return (
    <>
      <RichText text={e.summary} />
      {e.sectionId && (
        <p>
          Full rules: <EntryLink id={e.sectionId} />
        </p>
      )}
    </>
  );
}

function Body({ e }: { e: Entry }) {
  switch (e.type) {
    case "class": return <ClassView e={e} />;
    case "subclass": return <SubclassView e={e} />;
    case "domain": return <DomainView e={e} />;
    case "domain-card": return <DomainCardView e={e} />;
    case "ancestry": return <AncestryView e={e} />;
    case "community":
      return (<><RichText text={e.text} /><Features title="Community feature" features={[e.feature]} /></>);
    case "transformation":
      return (<><RichText text={e.text} /><Features title="Transformation features" features={e.features} /><h2>Questions</h2><ul>{e.questions.map((q, i) => <li key={i}><Inline text={q} /></li>)}</ul></>);
    case "beastform": return <BeastformView e={e} />;
    case "weapon": return <WeaponView e={e} />;
    case "armor": return <ArmorView e={e} />;
    case "item":
    case "consumable":
      return (<><Stats items={[["Roll", e.roll], ["Table", e.table]]} /><RichText text={e.text} /></>);
    case "adversary": return <AdversaryView e={e} />;
    case "environment": return <EnvironmentView e={e} />;
    case "progression": return <ProgressionView e={e} />;
    case "condition": return <RichText text={e.text} />;
    case "glossary": return <GlossaryView e={e} />;
    case "rules": return <Navigate to={entryPath(e)} replace />;
  }
}

export function EntryView({ e }: { e: Entry }) {
  return (
    <article className="entry" aria-labelledby="entry-title">
      <header>
        <p className="eyebrow">
          {TYPE_LABELS[e.type]}
          {e.source.kind === "homebrew" && <span className="badge-homebrew">Homebrew</span>}
        </p>
        <h1 id="entry-title">
          {e.type === "domain" && <DomainIcon pack={e.pack} icon={e.icon} size={32} />} {e.name}
        </h1>
        <p className="source">Source: {sourceLabel(e)}</p>
      </header>
      <Body e={e} />
    </article>
  );
}
