// Renders content RichText: light markdown (paragraphs, ###, lists, tables, **bold**, _italic_)
// plus {{term:slug|label}} tooltips and {{ref:id|label}} links.
import { Fragment, type ReactNode, useEffect, useId, useRef, useState } from "react";
import { Link } from "react-router";
import { stripTags } from "../../content/richtext.ts";
import { useContent } from "../content/ContentProvider.tsx";
import { entryPath } from "../content/registry.ts";

const INLINE = /\{\{(term|ref):([^|}]+)(?:\|([^}]*))?\}\}|\*\*(.+?)\*\*|(?<![\p{L}\d])_(.+?)_(?![\p{L}\d])/gu;

export function Inline({ text, links = true }: { text: string; links?: boolean }) {
  const out: ReactNode[] = [];
  let last = 0;
  let k = 0;
  for (const m of text.matchAll(INLINE)) {
    if (m.index! > last) out.push(text.slice(last, m.index));
    const [, kind, target, label, bold, italic] = m;
    if (kind === "term") out.push(links ? <TermLink key={k++} slug={target} label={label ?? target} /> : (label ?? target));
    else if (kind === "ref") out.push(links ? <RefLink key={k++} id={target} label={label} /> : (label ?? target));
    else if (bold !== undefined) out.push(<strong key={k++}><Inline text={bold} links={links} /></strong>);
    else out.push(<em key={k++}><Inline text={italic} links={links} /></em>);
    last = m.index! + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return <>{out}</>;
}

type Block = { kind: "p" | "h"; text: string; level?: number } | { kind: "ul" | "ol"; items: string[] } | { kind: "table"; head: string[]; rows: string[][] };

/** Split a table row on "|", ignoring escaped pipes and the pipe inside {{term:x|label}} tags. */
function splitCells(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < row.length; i++) {
    const c = row[i];
    if (c === "{" && row[i + 1] === "{") depth++;
    if (c === "}" && row[i + 1] === "}") depth = Math.max(0, depth - 1);
    if (c === "\\" && row[i + 1] === "|") {
      cur += "|";
      i++;
    } else if (c === "|" && depth === 0) {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

export function parseBlocks(md: string): Block[] {
  const out: Block[] = [];
  for (const chunk of md.split(/\n{2,}/)) {
    const lines = chunk.split("\n").filter((l) => l.trim());
    if (!lines.length) continue;
    const h = lines[0].match(/^(#{1,4}) (.*)$/);
    if (h && lines.length === 1) out.push({ kind: "h", level: h[1].length, text: h[2] });
    else if (lines.every((l) => l.trim().startsWith("|"))) {
      const cells = (l: string) => splitCells(l.trim().replace(/^\||\|$/g, ""));
      const body = lines.filter((l) => !/^\|( *-+ *\|)+$/.test(l.trim()));
      out.push({ kind: "table", head: cells(body[0]), rows: body.slice(1).map(cells) });
    } else if (lines.every((l) => /^- /.test(l))) out.push({ kind: "ul", items: lines.map((l) => l.slice(2)) });
    else if (lines.every((l) => /^\d+\. /.test(l))) out.push({ kind: "ol", items: lines.map((l) => l.replace(/^\d+\. /, "")) });
    else out.push({ kind: "p", text: lines.join(" ") });
  }
  return out;
}

/** Block-level rich text. `headingBase` shifts ### so it nests under the page's own headings. */
export function RichText({ text, headingBase = 2 }: { text: string; headingBase?: number }) {
  return (
    <>
      {parseBlocks(text).map((b, i) => {
        switch (b.kind) {
          case "h": {
            const level = Math.min(6, headingBase + (b.level ?? 3) - 2);
            const H = `h${level}` as "h3";
            return <H key={i}><Inline text={b.text} /></H>;
          }
          case "ul":
          case "ol": {
            const L = b.kind;
            return <L key={i}>{b.items.map((it, j) => <li key={j}><Inline text={it} /></li>)}</L>;
          }
          case "table":
            return (
              <div className="table-wrap" key={i}>
                <table>
                  <thead><tr>{b.head.map((c, j) => <th key={j} scope="col"><Inline text={c} /></th>)}</tr></thead>
                  <tbody>{b.rows.map((r, j) => <tr key={j}>{r.map((c, n) => <td key={n}><Inline text={c} /></td>)}</tr>)}</tbody>
                </table>
              </div>
            );
          default:
            return <p key={i}><Inline text={b.text} /></p>;
        }
      })}
    </>
  );
}

export function RefLink({ id, label }: { id: string; label?: string }) {
  const { registry } = useContent();
  const target = registry?.byId.get(id);
  if (!target) return <>{label ?? id}</>;
  return <Link to={entryPath(target)}>{label ?? target.name}</Link>;
}

/** A rules term: tooltip on hover/focus (tap on touch), click opens the glossary entry. */
export function TermLink({ slug, label }: { slug: string; label: string }) {
  const { registry } = useContent();
  const term = registry?.glossary.get(slug);
  const [open, setOpen] = useState(false);
  const pointer = useRef<string>("mouse");
  const tipId = useId();
  const wrap = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    const onDown = (e: PointerEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open]);

  if (!term) return <>{label}</>;
  return (
    <span className="term" ref={wrap} onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Link
        to={entryPath(term)}
        className="term-link"
        aria-describedby={open ? tipId : undefined}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onPointerDown={(e) => (pointer.current = e.pointerType)}
        onClick={(e) => {
          // touch: first tap shows the tooltip, the second follows the link
          if (pointer.current === "touch" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
      >
        {label}
      </Link>
      {open && (
        <span role="tooltip" id={tipId} className="tooltip">
          <strong>{term.name}.</strong> {stripTags(term.summary).replace(/\*\*|(?<![\p{L}\d])_|_(?![\p{L}\d])/gu, "")}
          {pointer.current === "touch" && (
            <Fragment>
              {" "}
              <Link to={entryPath(term)}>Open entry</Link>
            </Fragment>
          )}
        </span>
      )}
    </span>
  );
}
