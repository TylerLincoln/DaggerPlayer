// Local character store + autosave to Supabase.
// Every change is written to localStorage first, so closing the tab never loses work; when signed in,
// changes are pushed with save_character (rev-checked). Stage 7 replaces this with IndexedDB + an outbox.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type CharacterDoc, CharacterDoc as CharacterSchema } from "../rules/character.ts";
import { type SaveReason, saveCharacter } from "./repo.ts";

export interface LocalRecord {
  doc: CharacterDoc;
  /** server rev this copy is based on (0 = never saved) */
  rev: number;
  dirty: boolean;
  /** user id that owns the server copy; null for a guest draft */
  owner: string | null;
  updatedAt: string;
  conflict?: { rev: number; data: unknown; updated_at: string };
}

const KEY = "dp.characters.v1";
let records: Record<string, LocalRecord> = load();
const listeners = new Set<() => void>();

function load(): Record<string, LocalRecord> {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return typeof raw === "object" && raw ? raw : {};
  } catch {
    return {};
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(records));
  } catch {
    /* storage full or blocked: in-memory only until stage 7's IndexedDB cache */
  }
}

function emit() {
  persist();
  listeners.forEach((l) => l());
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

// other tabs: pick up their writes
if (typeof window !== "undefined")
  window.addEventListener("storage", (e) => {
    if (e.key === KEY) {
      records = load();
      listeners.forEach((l) => l());
    }
  });

export function putRecord(r: LocalRecord) {
  records = { ...records, [r.doc.id]: r };
  emit();
}

export function getRecord(id: string): LocalRecord | undefined {
  return records[id];
}

export function removeRecord(id: string) {
  const { [id]: _, ...rest } = records;
  records = rest;
  emit();
}

export function createLocal(doc: CharacterDoc, owner: string | null) {
  putRecord({ doc, rev: 0, dirty: true, owner, updatedAt: new Date().toISOString() });
}

/** Import a server row into the local store (keeps unsaved local edits unless asked to replace). */
export function adoptServer(row: { id: string; rev: number; data: unknown }, owner: string, replace = false) {
  const local = records[row.id];
  if (local && local.dirty && !replace) return;
  const parsed = CharacterSchema.safeParse(row.data);
  if (!parsed.success) return;
  putRecord({ doc: parsed.data, rev: row.rev, dirty: false, owner, updatedAt: new Date().toISOString() });
}

export function useRecords(): Record<string, LocalRecord> {
  return useSyncExternalStore(subscribe, () => records, () => records);
}

export function useCharacterRecord(id: string | undefined) {
  const all = useRecords();
  const rec = id ? all[id] : undefined;
  const update = useCallback(
    (fn: (d: CharacterDoc) => CharacterDoc) => {
      const cur = id ? records[id] : undefined;
      if (!cur) return;
      putRecord({ ...cur, doc: fn(structuredClone(cur.doc)), dirty: true, updatedAt: new Date().toISOString() });
    },
    [id],
  );
  return [rec, update] as const;
}

export type SaveStatus = "local-only" | "saving" | "saved" | "unsaved" | "error" | "conflict" | "other-account";

/**
 * Pushes dirty changes for one character while signed in, debounced.
 * `reason` lets the caller force a snapshot (builder finish, level-up, …).
 */
export function useAutosave(id: string | undefined, userId: string | null) {
  const all = useRecords();
  const rec = id ? all[id] : undefined;
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const save = useCallback(
    async (reason: SaveReason = "autosave") => {
      const cur = id ? records[id] : undefined;
      if (!cur || !userId || inFlight.current) return;
      if (cur.owner && cur.owner !== userId) return setStatus("other-account");
      inFlight.current = true;
      setStatus("saving");
      const sentAt = cur.updatedAt;
      try {
        const res = await saveCharacter({ id: cur.doc.id, baseRev: cur.rev, data: cur.doc, name: cur.doc.identity.name, level: 1 + cur.doc.levelUps.length, classId: cur.doc.build.classId, reason });
        const latest = records[cur.doc.id];
        if (res.status === "ok") {
          // edits made while saving stay dirty and go out on the next round
          putRecord({ ...latest, rev: res.rev, owner: userId, dirty: latest.updatedAt !== sentAt, conflict: undefined });
          setStatus(latest.updatedAt !== sentAt ? "unsaved" : "saved");
          setError(null);
        } else if (res.status === "conflict") {
          putRecord({ ...latest, conflict: { rev: res.rev, data: res.data, updated_at: res.updated_at } });
          setStatus("conflict");
        } else {
          setError("This character was deleted on the server.");
          setStatus("error");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus("error");
      } finally {
        inFlight.current = false;
      }
    },
    [id, userId],
  );

  useEffect(() => {
    if (!rec) return;
    if (!userId) return setStatus("local-only");
    if (rec.owner && rec.owner !== userId) return setStatus("other-account");
    if (rec.conflict) return setStatus("conflict");
    if (!rec.dirty) return setStatus("saved");
    setStatus("unsaved");
    const t = setTimeout(() => save(), 1200);
    return () => clearTimeout(t);
  }, [rec, userId, save]);

  // flush when the tab is hidden (closing, switching apps at the table)
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && records[id ?? ""]?.dirty && save();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [id, save]);

  /** Resolve a conflict: keep this device's copy (overwrite the server) or take the server's. */
  const resolve = useCallback(
    (keep: "mine" | "theirs") => {
      const cur = id ? records[id] : undefined;
      if (!cur?.conflict) return;
      if (keep === "mine") putRecord({ ...cur, rev: cur.conflict.rev, conflict: undefined, dirty: true });
      else {
        const parsed = CharacterSchema.safeParse(cur.conflict.data);
        if (parsed.success) putRecord({ ...cur, doc: parsed.data, rev: cur.conflict.rev, conflict: undefined, dirty: false });
      }
    },
    [id],
  );

  return { status, error, save, resolve };
}
