import { type ChangeEvent, useEffect, useState } from "react";
import { Link, Navigate, useNavigate, useParams } from "react-router";
import { useContent } from "../../content/ContentProvider.tsx";
import { adoptServer, createLocal, removeRecord, useAutosave, useCharacterRecord, useRecords } from "../../data/characters.ts";
import { type CharacterRow, listCharacters } from "../../data/repo.ts";
import { supabase } from "../../data/supabase.ts";
import { CharacterDoc } from "../../rules/character.ts";
import { derive } from "../../rules/derive.ts";
import { MAX_LEVEL, undoLastLevelUp } from "../../rules/levelup.ts";
import { formatMod } from "../../rules/traits.ts";
import { FormMessage, errorText } from "../../ui/forms.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";
import { SaveIndicator } from "../builder/BuilderPage.tsx";

function download(name: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

const fileName = (c: CharacterDoc) => `${(c.identity.name || "character").replace(/[^\w-]+/g, "-").toLowerCase()}.daggerplayer.json`;

export function CharactersPage() {
  const { user } = useAuth();
  const records = useRecords();
  const navigate = useNavigate();
  const [server, setServer] = useState<CharacterRow[]>([]);
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});

  useEffect(() => {
    if (!user) return;
    listCharacters()
      .then((rows) => {
        setServer(rows);
        for (const r of rows) adoptServer(r, user.id); // keeps unsaved local edits
      })
      .catch((e) => setMsg({ error: errorText(e) }));
  }, [user]);

  const mine = Object.values(records)
    .filter((r) => (user ? r.owner === user.id || r.owner === null : r.owner === null))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

  const importFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = CharacterDoc.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) throw new Error("That file isn't a DaggerPlayer character.");
      // imports always get a new id so they never overwrite an existing character
      const doc = { ...parsed.data, id: crypto.randomUUID() };
      createLocal(doc, user?.id ?? null);
      navigate(doc.finishedAt ? `/characters/${doc.id}` : `/build/${doc.id}/review`);
    } catch (err) {
      setMsg({ error: errorText(err) });
    }
  };

  const remove = async (id: string, name: string) => {
    if (!confirm(`Delete ${name || "this character"}? Its saved history goes too.`)) return;
    try {
      const rec = records[id];
      if (user && rec?.rev) {
        const { error } = await supabase.from("characters").update({ deleted_at: new Date().toISOString() }).eq("id", id);
        if (error) throw error;
      }
      removeRecord(id);
      setServer((s) => s.filter((r) => r.id !== id));
    } catch (err) {
      setMsg({ error: errorText(err) });
    }
  };

  return (
    <>
      <h1>Your characters</h1>
      <p>
        <Link className="button primary" to="/build/new">New character</Link>{" "}
        <label className="button">
          Import JSON <input type="file" accept="application/json,.json" className="visually-hidden" onChange={importFile} />
        </label>
      </p>
      <FormMessage error={msg.error} info={msg.info} />
      {!user && <p className="hint">Not signed in: characters are kept on this device. <Link to="/auth/sign-in?next=/characters">Sign in</Link> to save them to your account.</p>}
      {mine.length === 0 ? (
        <p>No characters yet.</p>
      ) : (
        <ul className="character-list">
          {mine.map(({ doc, dirty, rev }) => (
            <li key={doc.id}>
              <Link to={doc.finishedAt ? `/characters/${doc.id}` : `/build/${doc.id}/review`}>{doc.identity.name || "Unnamed character"}</Link>{" "}
              <span className="hint">
                Level {1 + doc.levelUps.length}
                {!doc.finishedAt && " · draft"}
                {user && (rev === 0 ? " · not uploaded yet" : dirty ? " · unsaved changes" : "")}
              </span>{" "}
              <button type="button" onClick={() => download(fileName(doc), doc)}>Export</button>{" "}
              <button type="button" onClick={() => remove(doc.id, doc.identity.name)}>Delete</button>
            </li>
          ))}
        </ul>
      )}
      {user && server.length > mine.length && <p className="hint">Some saved characters couldn't be read on this device.</p>}
    </>
  );
}

/** Stage 4 placeholder for the sheet: a summary of the finished character. The full sheet is stage 5. */
export function CharacterPage() {
  const { id } = useParams();
  const { registry } = useContent();
  const { user } = useAuth();
  const [rec, update] = useCharacterRecord(id);
  const { status, error } = useAutosave(id, user?.id ?? null);
  if (!rec) return <><h1>Character not found</h1><Link to="/characters">Your characters</Link></>;
  if (!rec.doc.finishedAt) return <Navigate to={`/build/${rec.doc.id}/review`} replace />;
  if (!registry) return <p role="status">Loading content…</p>;
  const c = rec.doc;
  const d = derive(c, registry);
  const name = (x: string | null) => (x ? registry.byId.get(x)?.name ?? x : "—");
  return (
    <>
      <h1>{c.identity.name}</h1>
      <SaveIndicator status={status} error={error} />
      <p>Level {d.level} {name(c.build.subclassId)} {name(c.build.classId)}</p>
      <dl className="stats">
        {[["Evasion", d.evasion.total], ["Hit Points", d.hpMax.total], ["Stress", d.stressMax.total], ["Hope", `${c.state.hope} / ${d.hopeMax}`], ["Armor Score", d.armorScore.total], ["Thresholds", `${d.thresholds.major.total} / ${d.thresholds.severe.total}`], ["Proficiency", d.proficiency.total]].map(([k, v]) => (
          <div key={k as string}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
        {Object.entries(d.traits).map(([t, s]) => <div key={t}><dt>{t.charAt(0).toUpperCase() + t.slice(1)}</dt><dd>{formatMod(s.total)}</dd></div>)}
      </dl>
      <p className="hint">The full play sheet (trackers, dice, loadout) comes in stage 5.</p>
      <p>
        {d.level < MAX_LEVEL && <Link className="button primary" to={`/characters/${c.id}/level-up`}>Level up</Link>}{" "}
        {c.levelUps.length > 0 && (
          <button type="button" onClick={() => confirm(`Undo the level ${d.level} level-up?`) && update((x) => undoLastLevelUp(x))}>Undo last level-up</button>
        )}
      </p>
      <p><Link to={`/build/${c.id}/review`}>Edit build</Link> · <Link to="/characters">All characters</Link></p>
    </>
  );
}
