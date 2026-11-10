import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useContent } from "../../content/ContentProvider.tsx";
import { putRecord, useAutosave, useCharacterRecord } from "../../data/characters.ts";
import { useOnline } from "../../data/outbox.ts";
import { listVersions, type SaveReason } from "../../data/repo.ts";
import { supabase } from "../../data/supabase.ts";
import { CharacterDoc } from "../../rules/character.ts";
import { compareCharacters } from "../../rules/compare.ts";
import { FormMessage, errorText } from "../../ui/forms.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";

const REASON: Record<SaveReason, string> = {
  autosave: "Autosave",
  "level-up": "Level up",
  "builder-finish": "Finished in the builder",
  import: "Imported",
  restore: "Restored",
  conflict: "Kept from a two-device conflict",
};

type Version = Awaited<ReturnType<typeof listVersions>>[number];

/** The last 20 saved versions of a character, with a comparison to the current one and restore. */
export function HistoryPage() {
  const { id } = useParams();
  const { registry: reg } = useContent();
  const { user } = useAuth();
  const online = useOnline();
  const [rec] = useCharacterRecord(id);
  const { save } = useAutosave(id, user?.id ?? null);
  const navigate = useNavigate();
  const [versions, setVersions] = useState<Version[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [msg, setMsg] = useState<{ error?: string; info?: string }>({});

  useEffect(() => {
    if (!id || !user || !online) return;
    listVersions(id).then(setVersions).catch((e) => setMsg({ error: errorText(e) }));
  }, [id, user, online]);

  if (!rec) return <><h1>Character not found</h1><Link to="/characters">Your characters</Link></>;
  const c = rec.doc;
  if (!user) return <><h1>History</h1><p>Version history is kept in your account. <Link to={`/auth/sign-in?next=/characters/${c.id}/history`}>Sign in</Link> to use it.</p></>;
  if (!online) return <><h1>History</h1><p>You're offline. Version history is stored in your account and needs a connection.</p><Link to={`/characters/${c.id}`}>Back to the sheet</Link></>;
  if (rec.rev === 0) return <><h1>History</h1><p>This character hasn't been saved to your account yet.</p></>;

  const restore = async (v: Version) => {
    if (!confirm(`Restore the version from ${new Date(v.created_at).toLocaleString()}? Your current version is kept in the history.`)) return;
    try {
      const parsed = CharacterDoc.safeParse(v.data);
      if (!parsed.success) throw new Error("That version couldn't be read.");
      // keep the current state so the restore itself can be undone
      const { error } = await supabase.from("character_versions").insert({ character_id: c.id, rev: rec.rev, reason: "autosave", data: c });
      if (error) throw error;
      putRecord({ ...rec, doc: { ...parsed.data, id: c.id }, dirty: true, updatedAt: new Date().toISOString() });
      await save("restore");
      navigate(`/characters/${c.id}`);
    } catch (e) {
      setMsg({ error: errorText(e) });
    }
  };

  return (
    <>
      <h1>History: {c.identity.name}</h1>
      <p>The last 20 saved versions. Level-ups, finishing the builder, imports and restores always save a version; otherwise one is kept at most every 10 minutes.</p>
      <FormMessage error={msg.error} info={msg.info} />
      {!versions ? <p role="status">Loading…</p> : versions.length === 0 ? <p>No saved versions yet.</p> : (
        <ol className="history">
          {versions.map((v) => {
            const parsed = CharacterDoc.safeParse(v.data);
            const diffs = parsed.success && reg ? compareCharacters(c, parsed.data, reg) : [];
            return (
              <li key={v.id}>
                <div className="history-row">
                  <span><strong>{REASON[v.reason] ?? v.reason}</strong> · {new Date(v.created_at).toLocaleString()} · level {parsed.success ? 1 + parsed.data.levelUps.length : "?"}</span>
                  <span>
                    <button type="button" aria-expanded={open === v.id} onClick={() => setOpen(open === v.id ? null : v.id)}>Compare</button>{" "}
                    <button type="button" onClick={() => restore(v)} disabled={!parsed.success}>Restore</button>
                  </span>
                </div>
                {open === v.id && (
                  diffs.length === 0 ? <p className="hint">Same as the current version on the sheet.</p> : (
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th scope="col">What</th><th scope="col">Now</th><th scope="col">This version</th></tr></thead>
                        <tbody>{diffs.map((d) => <tr key={d.label + d.mine}><th scope="row">{d.label}</th><td>{d.mine}</td><td>{d.theirs}</td></tr>)}</tbody>
                      </table>
                    </div>
                  )
                )}
              </li>
            );
          })}
        </ol>
      )}
      <p><Link to={`/characters/${c.id}`}>Back to the sheet</Link></p>
    </>
  );
}
