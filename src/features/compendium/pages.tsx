import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import type { EntryOf, EntryType } from "../../../content/schema/index.ts";
import { useContent } from "../../content/ContentProvider.tsx";
import { bundledPacks } from "../../content/packs.ts";
import { entryPath, TYPE_LABELS } from "../../content/registry.ts";
import { DomainIcon } from "../../ui/DomainIcon.tsx";
import { RichText } from "../../ui/RichText.tsx";
import { EntryView } from "./EntryView.tsx";

function Loading() {
  return <p role="status">Loading content…</p>;
}

export function PackToggles() {
  const { enabledPacks, setPackEnabled } = useContent();
  return (
    <fieldset className="packs">
      <legend>Content packs</legend>
      {bundledPacks.map((p) => {
        const required = bundledPacks.some((o) => o.requires.includes(p.id) && enabledPacks.includes(o.id));
        return (
          <label key={p.id}>
            <input type="checkbox" checked={enabledPacks.includes(p.id)} disabled={required} onChange={(e) => setPackEnabled(p.id, e.target.checked)} />{" "}
            {p.name}
            {required && <small> (needed by another pack)</small>}
          </label>
        );
      })}
    </fieldset>
  );
}

const SEARCH_TYPES: EntryType[] = [
  "class", "subclass", "domain", "domain-card", "ancestry", "community", "transformation", "beastform",
  "weapon", "armor", "item", "consumable", "adversary", "environment", "condition", "glossary", "rules", "progression",
];

export function CompendiumPage() {
  const { registry, search } = useContent();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const [draft, setDraft] = useState(q);
  const filters = {
    type: params.get("type") ?? undefined,
    tier: params.get("tier") ? Number(params.get("tier")) : undefined,
    domain: params.get("domain") ?? undefined,
    class: params.get("class") ?? undefined,
    source: params.get("source") ?? undefined,
  };
  const set = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  // debounce typing into the URL
  useEffect(() => {
    const t = setTimeout(() => draft !== q && set("q", draft), 200);
    return () => clearTimeout(t);
  }, [draft]); // eslint-disable-line react-hooks/exhaustive-deps

  const result = useMemo(() => search?.search(q, filters), [search, q, filters.type, filters.tier, filters.domain, filters.class, filters.source]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!registry || !result) return <Loading />;

  const anyFilter = q || Object.values(filters).some(Boolean);
  return (
    <div className="compendium">
      <h1>Compendium</h1>
      <form role="search" onSubmit={(e) => e.preventDefault()} className="search-form">
        <label htmlFor="q">Search</label>
        <input id="q" type="search" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="e.g. Vulnerable, longsword, Hope" autoComplete="off" />
        <div className="filters">
          <Select label="Type" value={filters.type} onChange={(v) => set("type", v)} options={SEARCH_TYPES.map((t) => [t, TYPE_LABELS[t]])} />
          <Select label="Tier" value={filters.tier ? String(filters.tier) : undefined} onChange={(v) => set("tier", v)} options={[1, 2, 3, 4].map((t) => [String(t), `Tier ${t}`])} />
          <Select label="Domain" value={filters.domain} onChange={(v) => set("domain", v)} options={registry.all("domain").map((d) => [d.id, d.name])} />
          <Select label="Class" value={filters.class} onChange={(v) => set("class", v)} options={registry.all("class").map((c) => [c.id, c.name])} />
          <Select label="Source" value={filters.source} onChange={(v) => set("source", v)} options={registry.packs.map((p) => [p.id, p.name])} />
        </div>
        {anyFilter && (
          <button type="button" onClick={() => { setDraft(""); setParams(new URLSearchParams(), { replace: true }); }}>
            Clear
          </button>
        )}
      </form>
      <p role="status" aria-live="polite" className="hint">
        {result.total} {result.total === 1 ? "result" : "results"}
        {result.total > result.hits.length && ` (showing the first ${result.hits.length})`}
      </p>
      <ul className="results">
        {result.hits.map(({ entry: e, facets }) => (
          <li key={e.id}>
            <Link to={entryPath(e)}>
              {e.type === "domain" && <DomainIcon pack={e.pack} icon={e.icon} size={18} />} {e.name}
            </Link>{" "}
            <span className="hint">
              {TYPE_LABELS[e.type]}
              {facets.tier ? ` · Tier ${facets.tier}` : ""}
              {e.type === "domain-card" ? ` · Level ${e.level} ${registry.get(e.domainId)?.name ?? ""}` : ""}
              {e.pack !== "srd" ? ` · ${registry.pack(e.pack)?.name ?? e.pack}` : ""}
            </span>
          </li>
        ))}
      </ul>
      <PackToggles />
    </div>
  );
}

function Select({ label, value, onChange, options }: { label: string; value?: string; onChange: (v: string) => void; options: [string, string][] }) {
  const id = `f-${label.toLowerCase()}`;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value ?? ""} onChange={(e) => onChange(e.target.value)}>
        <option value="">Any</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
    </div>
  );
}

export function EntryPage() {
  const { pack, type, slug } = useParams();
  const { registry, enabledPacks } = useContent();
  const id = `${pack}/${type}/${slug}`;
  const titleRef = useRef<string>("");
  const e = registry?.byId.get(id);
  useEffect(() => {
    titleRef.current = document.title;
    if (e) document.title = `${e.name} · DaggerPlayer`;
    return () => {
      document.title = titleRef.current || "DaggerPlayer";
    };
  }, [e]);
  if (!registry) return <Loading />;
  if (!e) return <NotFoundEntry id={id} packOff={!!pack && !enabledPacks.includes(pack)} />;
  return (
    <>
      <nav aria-label="Breadcrumb" className="crumbs">
        <Link to="/compendium">Compendium</Link> › <Link to={`/compendium?type=${e.type}`}>{TYPE_LABELS[e.type]}</Link>
      </nav>
      <EntryView e={e} />
    </>
  );
}

function NotFoundEntry({ id, packOff }: { id: string; packOff: boolean }) {
  return (
    <>
      <h1>Entry not found</h1>
      <p>Nothing matches <code>{id}</code>.</p>
      {packOff && (
        <>
          <p>This entry belongs to a content pack that's turned off.</p>
          <PackToggles />
        </>
      )}
      <Link to="/compendium">Back to the compendium</Link>
    </>
  );
}

// ---------- rules ----------

function Toc({ pack, current }: { pack: string; current?: string }) {
  const { registry } = useContent();
  if (!registry) return null;
  const roots = registry.all("rules").filter((r) => r.pack === pack && !r.parentId).sort((a, b) => a.order - b.order);
  const node = (r: EntryOf<"rules">) => {
    const kids = registry.childrenOf(r.id) as EntryOf<"rules">[];
    return (
      <li key={r.id}>
        <Link to={entryPath(r)} aria-current={r.id === current ? "page" : undefined}>
          {r.name}
        </Link>
        {kids.length > 0 && <ul>{kids.map(node)}</ul>}
      </li>
    );
  };
  return (
    <nav aria-label={`${registry.pack(pack)?.name ?? pack} contents`} className="toc">
      <ul>{roots.map(node)}</ul>
    </nav>
  );
}

export function RulesIndexPage() {
  const { registry } = useContent();
  if (!registry) return <Loading />;
  return (
    <>
      <h1>Rules</h1>
      {registry.packs.map((p) => (
        <section key={p.id}>
          <h2>{p.name}</h2>
          <Toc pack={p.id} />
        </section>
      ))}
      <PackToggles />
    </>
  );
}

export function RulesPage() {
  const { pack, slug } = useParams();
  const { registry, enabledPacks } = useContent();
  if (!registry) return <Loading />;
  const id = `${pack}/rules/${slug}`;
  const e = registry.get(id, "rules");
  if (!e) return <NotFoundEntry id={id} packOff={!!pack && !enabledPacks.includes(pack)} />;

  const all = registry.all("rules").filter((r) => r.pack === e.pack).sort((a, b) => a.order - b.order);
  const i = all.findIndex((r) => r.id === e.id);
  const [prev, next] = [all[i - 1], all[i + 1]];
  const parent = registry.get(e.parentId, "rules");
  const kids = registry.childrenOf(e.id) as EntryOf<"rules">[];

  return (
    <div className="rules-layout">
      <aside>
        <details open={typeof window !== "undefined" && window.matchMedia("(min-width: 960px)").matches}>
          <summary>Contents</summary>
          <Toc pack={e.pack} current={e.id} />
        </details>
      </aside>
      <article aria-labelledby="rules-title" className="entry">
        <nav aria-label="Breadcrumb" className="crumbs">
          <Link to="/rules">Rules</Link>
          {parent && <> › <Link to={entryPath(parent)}>{parent.name}</Link></>}
        </nav>
        <h1 id="rules-title">{e.name}</h1>
        <p className="source">Source: {e.source.document} · p. {e.source.page}{e.source.pageEnd ? `–${e.source.pageEnd}` : ""}</p>
        <RichText text={e.text} />
        {kids.length > 0 && (
          <section aria-label="In this section">
            <h2>In this section</h2>
            <ul>{kids.map((k) => <li key={k.id}><Link to={entryPath(k)}>{k.name}</Link></li>)}</ul>
          </section>
        )}
        <nav aria-label="Previous and next" className="prevnext">
          {prev ? <Link to={entryPath(prev)}>← {prev.name}</Link> : <span />}
          {next ? <Link to={entryPath(next)}>{next.name} →</Link> : <span />}
        </nav>
      </article>
    </div>
  );
}
