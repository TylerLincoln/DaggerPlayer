import { type ChangeEvent, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router";
import { adoptServer, createLocal, removeRecord, useRecords } from "../../data/characters.ts";
import { type CharacterRow, listCharacters } from "../../data/repo.ts";
import { supabase } from "../../data/supabase.ts";
import { CharacterDoc } from "../../rules/character.ts";
import { FormMessage, errorText } from "../../ui/forms.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";

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
