// Local character store + autosave to Supabase.
// Every change is written to localStorage first, so closing the tab never loses work; when signed in,
// changes are pushed with save_character (rev-checked). Stage 7 replaces this with IndexedDB + an outbox.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { type CharacterDoc, CharacterDoc as CharacterSchema } from "../rules/character.ts";
import { isNetworkError, isOnline, onReconnect, useOnline } from "./outbox.ts";
import { type SaveReason, saveCharacter } from "./repo.ts";
import { supabase } from "./supabase.ts";

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

export type SaveStatus = "local-only" | "saving" | "saved" | "unsaved" | "offline" | "error" | "conflict" | "other-account";

const RETRY_MS = 20_000;

/** Fetch the server copy of one character. */
async function fetchServerRow(id: string) {
  const { data, error } = await supabase.from("characters").select("id, rev, data, updated_at, deleted_at").eq("id", id).maybeSingle();
  if (error) throw error;
  return data as { id: string; rev: number; data: unknown; updated_at: string; deleted_at: string | null } | null;
}

/** Keep a copy in the version history (used before a conflict resolution discards it). */
async function snapshot(characterId: string, rev: number, data: unknown) {
  const { error } = await supabase.from("character_versions").insert({ character_id: characterId, rev, reason: "conflict", data });
  if (error) throw error;
}

/**
 * Pushes dirty changes for one character while signed in, debounced. Changes are always on this
 * device first, so being offline only delays the upload: it retries when the connection returns.
 * `save(reason)` forces a snapshot (builder finish, level-up, restore, …).
 */
export function useAutosave(id: string | undefined, userId: string | null) {
  const all = useRecords();
  const rec = id ? all[id] : undefined;
  const online = useOnline();
  const [status, setStatus] = useState<SaveStatus>("saved");
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);

  const save = useCallback(
    async (reason: SaveReason = "autosave") => {
      const cur = id ? records[id] : undefined;
      if (!cur || !userId || inFlight.current) return;
      if (cur.owner && cur.owner !== userId) return setStatus("other-account");
      if (!isOnline()) return setStatus("offline");
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
          setError("This character was deleted from your account on another device. It's still on this device: export it, or delete it here.");
          setStatus("error");
        }
      } catch (e) {
        if (isNetworkError(e)) setStatus("offline");
        else {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
      } finally {
        inFlight.current = false;
      }
    },
    [id, userId],
  );

  // pick up a newer server copy when the character opens (only if there are no local edits)
  useEffect(() => {
    if (!id || !userId || !online) return;
    const cur = records[id];
    if (!cur || (cur.owner && cur.owner !== userId) || cur.rev === 0) return;
    fetchServerRow(id)
      .then((row) => {
        const latest = records[id];
        if (row && !row.deleted_at && row.rev > latest.rev && !latest.dirty) adoptServer(row, userId, true);
      })
      .catch(() => {});
  }, [id, userId, online]);

  useEffect(() => {
    if (!rec) return;
    if (!userId) return setStatus("local-only");
    if (rec.owner && rec.owner !== userId) return setStatus("other-account");
    if (rec.conflict) return setStatus("conflict");
    if (!rec.dirty) return setStatus("saved");
    if (!online) return setStatus("offline");
    setStatus((s) => (s === "error" || s === "offline" ? s : "unsaved"));
    const t = setTimeout(() => save(), 1200);
    return () => clearTimeout(t);
  }, [rec, userId, online, save]);

  // retry: when the connection returns, and every 20 s while something is waiting
  useEffect(() => onReconnect(() => records[id ?? ""]?.dirty && save()), [id, save]);
  useEffect(() => {
    if (!rec?.dirty || !userId || rec.conflict) return;
    const t = setInterval(() => isOnline() && save(), RETRY_MS);
    return () => clearInterval(t);
  }, [rec?.dirty, rec?.conflict, userId, save]);

  // flush when the tab is hidden (closing, switching apps at the table)
  useEffect(() => {
    const onHide = () => document.visibilityState === "hidden" && records[id ?? ""]?.dirty && save();
    document.addEventListener("visibilitychange", onHide);
    return () => document.removeEventListener("visibilitychange", onHide);
  }, [id, save]);

  /**
   * Resolve a conflict. The version being discarded is first saved to the version history,
   * so the choice can be undone from the History page.
   */
  const resolve = useCallback(
    async (keep: "mine" | "theirs") => {
      const cur = id ? records[id] : undefined;
      if (!cur?.conflict) return;
      try {
        if (keep === "mine") {
          await snapshot(cur.doc.id, cur.conflict.rev, cur.conflict.data);
          putRecord({ ...cur, rev: cur.conflict.rev, conflict: undefined, dirty: true });
          await save("conflict");
        } else {
          const parsed = CharacterSchema.safeParse(cur.conflict.data);
          if (!parsed.success) throw new Error("The other device's copy couldn't be read.");
          await snapshot(cur.doc.id, cur.rev, cur.doc);
          putRecord({ ...cur, doc: parsed.data, rev: cur.conflict.rev, conflict: undefined, dirty: false });
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStatus(isNetworkError(e) ? "offline" : "error");
      }
    },
    [id, save],
  );

  return { status, error, save, resolve };
}
