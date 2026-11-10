import { useState } from "react";
import type { Registry } from "../../content/registry.ts";
import type { LocalRecord } from "../../data/characters.ts";
import { CharacterDoc } from "../../rules/character.ts";
import { compareCharacters } from "../../rules/compare.ts";

/** Shown when this device and another device both changed the character: compare and pick one. */
export function ConflictPanel({ rec, reg, resolve }: { rec: LocalRecord; reg: Registry; resolve: (keep: "mine" | "theirs") => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  if (!rec.conflict) return null;
  const parsed = CharacterDoc.safeParse(rec.conflict.data);
  const diffs = parsed.success ? compareCharacters(rec.doc, parsed.data, reg) : [];
  const pick = async (k: "mine" | "theirs") => {
    setBusy(true);
    await resolve(k);
    setBusy(false);
  };
  return (
    <section className="conflict" role="alert" aria-labelledby="conflict-h">
      <h2 id="conflict-h">Changed on another device</h2>
      <p>
        This character was also changed on another device (saved {new Date(rec.conflict.updated_at).toLocaleString()}). Pick the version to keep. The other one is saved in the
        character's history, so you can still get it back.
      </p>
      {diffs.length > 0 ? (
        <div className="table-wrap">
          <table>
            <thead><tr><th scope="col">What</th><th scope="col">This device</th><th scope="col">Other device</th></tr></thead>
            <tbody>{diffs.map((d) => <tr key={d.label + d.mine}><th scope="row">{d.label}</th><td>{d.mine}</td><td>{d.theirs}</td></tr>)}</tbody>
          </table>
        </div>
      ) : (
        <p className="hint">No visible differences on the sheet (only small details differ).</p>
      )}
      <button type="button" className="primary" disabled={busy} onClick={() => pick("mine")}>Keep this device's version</button>{" "}
      <button type="button" disabled={busy || !parsed.success} onClick={() => pick("theirs")}>Use the other device's version</button>
    </section>
  );
}
