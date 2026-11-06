// Classes, subclasses and domains (SRD pp. 7–31).
import type { EntryOf, Feature } from "../../content/schema/index.ts";
import { type Block, type Line, blocks, features, pages, plain, slug, titleCase, trait } from "./lines.ts";
import { src, PACK } from "./common.ts";

type Para = Extract<Block, { kind: "para" }>;

export function parseDomains(lines: Line[]): EntryOf<"domain">[] {
  const bs = blocks(pages(lines, 7, 7));
  const out: EntryOf<"domain">[] = [];
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.kind === "heading" && b.level === 2) {
      const paras: string[] = [];
      while (bs[i + 1]?.kind === "para") paras.push((bs[++i] as Para).text);
      const name = titleCase(b.text);
      out.push({ id: `${PACK}/domain/${slug(name)}`, type: "domain", name, pack: PACK, source: src(b.page), text: paras.join("\n\n") });
    }
  }
  if (out.length !== 10) throw new Error(`expected 10 domains, got ${out.length}`);
  return out;
}

/** Headings inside the class chapter that are not part of any class. */
const EXTRAS = /^(BEASTFORM OPTIONS|MARTIAL STANCES|RANGER COMPANION)$/;

export function parseClasses(lines: Line[]) {
  const bs = blocks(pages(lines, 9, 31));
  const classes: EntryOf<"class">[] = [];
  const subclasses: EntryOf<"subclass">[] = [];

  // A class starts at a level-2 heading whose next heading is "<CLASS>’S HOPE FEATURE".
  const starts: number[] = [];
  for (let i = 0; i < bs.length; i++) {
    const b = bs[i];
    if (b.kind !== "heading" || b.level !== 2) continue;
    const next = bs.slice(i + 1).find((x) => x.kind === "heading");
    if (next && /’S HOPE FEATURE$/.test(next.text)) starts.push(i);
  }
  const ends = starts.map((s, k) => {
    const limit = starts[k + 1] ?? bs.length;
    const extra = bs.findIndex((b, j) => j > s && j < limit && b.kind === "heading" && EXTRAS.test(b.text));
    return extra === -1 ? limit : extra;
  });

  starts.forEach((s, k) => {
    const sec = bs.slice(s, ends[k]);
    const name = titleCase((sec[0] as Extract<Block, { kind: "heading" }>).text);
    const id = `${PACK}/class/${slug(name)}`;
    let i = 1;
    const paras = () => {
      const out: Para[] = [];
      while (sec[i]?.kind === "para") out.push(sec[i++] as Para);
      return out;
    };
    const until = (re: RegExp) => {
      const out: Block[] = [];
      while (i < sec.length && !(sec[i].kind === "heading" && re.test(sec[i].text))) out.push(sec[i++]);
      return out;
    };

    // description + stat lines
    const head = paras();
    const stat = (label: string) => {
      const j = head.findIndex((p) => plain(p.text).startsWith(label));
      if (j === -1) throw new Error(`${name}: missing ${label}`);
      return { j, value: plain(head[j].text).slice(label.length).replace(/^\s*[–-]\s*/, "").trim() };
    };
    const firstStat = stat("DOMAINS").j;
    const text = head.slice(0, firstStat).map((p) => p.text).join("\n\n");
    const domainNames = stat("DOMAINS").value.split(/\s*&\s*/);
    const items = stat("CLASS ITEMS");
    const classItemsText = [items.value, ...head.slice(items.j + 1).map((p) => plain(p.text))].join(" ").replace(/\s+/g, " ");

    // hope feature
    if (!/’S HOPE FEATURE$/.test(sec[i]?.text ?? "")) throw new Error(`${name}: expected hope feature`);
    i++;
    const hope = features(paras());
    if (hope.length !== 1) throw new Error(`${name}: ${hope.length} hope features`);

    // class features (and any reference lists such as warlock spheres)
    if (!/^CLASS FEATURES?$/.test(sec[i]?.text ?? "")) throw new Error(`${name}: expected class features`);
    i++;
    const featBlocks = until(/SUBCLASSES$/);
    const lists: { title: string; items: string[] }[] = [];
    const listAt = featBlocks.findIndex((b) => b.kind === "heading");
    const classFeatures = features(listAt === -1 ? featBlocks : featBlocks.slice(0, listAt));
    if (listAt !== -1) {
      const lb = featBlocks.slice(listAt + 1) as Para[];
      // first paragraph is the instruction sentence; the rest are one item per line
      lists.push({
        title: titleCase(featBlocks[listAt].text),
        items: lb.slice(1).flatMap((p) => p.lines.map((l) => plain(l.text).trim())).filter(Boolean),
      });
      lb[0] && (classFeatures[classFeatures.length - 1].text += `\n\n${lb[0].text}`);
    }

    // subclass names from "Choose either the X or Y subclass."
    i++; // "<CLASS> SUBCLASSES"
    const choose = plain(paras().map((p) => p.text).join(" "));
    const m = choose.match(/Choose either the (.+?) or (.+?) subclass/);
    if (!m) throw new Error(`${name}: subclass sentence not found: ${choose}`);
    const subNames = [m[1], m[2]].map((n) => n.trim());

    const subIds: string[] = [];
    for (const [k2, sn] of subNames.entries()) {
      while (i < sec.length && !(sec[i].kind === "heading" && plain(sec[i].text) === sn.toUpperCase())) i++;
      if (i >= sec.length) throw new Error(`${name}: subclass heading ${sn} not found`);
      const page = sec[i].page;
      i++;
      const nextName = subNames[k2 + 1]?.toUpperCase();
      const body = until(nextName ? new RegExp(`^${nextName}$|^BACKGROUND QUESTIONS$`) : /^BACKGROUND QUESTIONS$/);
      const sub = parseSubclass(sn, id, page, body);
      subclasses.push(sub);
      subIds.push(sub.id);
    }

    // background + connections
    const questions = (re: RegExp) => {
      while (i < sec.length && !(sec[i].kind === "heading" && re.test(sec[i].text))) i++;
      i++;
      return paras()
        .filter((p) => p.bullet)
        .map((p) => p.text);
    };
    const backgroundQuestions = questions(/^BACKGROUND QUESTIONS$/);
    const connectionQuestions = questions(/^CONNECTIONS$/);

    classes.push({
      id,
      type: "class",
      name,
      pack: PACK,
      source: src(sec[0].page, sec[sec.length - 1].page),
      text,
      domainIds: domainNames.map((d) => `${PACK}/domain/${slug(d)}`) as [string, string],
      startingEvasion: Number(stat("STARTING EVASION").value),
      startingHp: Number(stat("STARTING HIT POINTS").value),
      classItems: classItemsText.split(/\s+or\s+/).map((s) => s.trim().replace(/^./, (c) => c.toUpperCase())),
      hopeFeature: hope[0],
      classFeatures,
      subclassIds: subIds,
      backgroundQuestions,
      connectionQuestions,
      ...(lists.length ? { lists } : {}),
    });
  });

  return { classes, subclasses, extrasFrom: ends.filter((e, k) => e !== (starts[k + 1] ?? bs.length)).map((e) => bs[e]) };
}

function parseSubclass(name: string, classId: string, page: number, body: Block[]): EntryOf<"subclass"> {
  let i = 0;
  const intro: string[] = [];
  while (body[i]?.kind === "para") intro.push((body[i++] as Para).text);
  let spellcastTrait: EntryOf<"subclass">["spellcastTrait"] = null;
  const groups: Record<string, Feature[]> = { FOUNDATION: [], SPECIALIZATION: [], MASTERY: [] };
  while (i < body.length) {
    const h = body[i++];
    if (h.kind !== "heading") throw new Error(`${name}: unexpected text ${h.text.slice(0, 60)}`);
    const paras: Para[] = [];
    while (body[i]?.kind === "para") paras.push(body[i++] as Para);
    if (h.text === "SPELLCAST TRAIT") spellcastTrait = trait(paras[0].text);
    else {
      const g = h.text.match(/^(FOUNDATION|SPECIALIZATION|MASTERY) FEATURES?$/)?.[1];
      if (!g) throw new Error(`${name}: unexpected heading ${h.text}`);
      groups[g].push(...features(paras));
    }
  }
  const pretty = titleCase(name);
  return {
    id: `${PACK}/subclass/${slug(pretty)}`,
    type: "subclass",
    name: pretty,
    pack: PACK,
    source: src(page),
    classId,
    text: intro.join("\n\n"),
    spellcastTrait,
    foundation: groups.FOUNDATION,
    specialization: groups.SPECIALIZATION,
    mastery: groups.MASTERY,
  };
}
