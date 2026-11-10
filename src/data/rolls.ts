// Roll history per character: kept on the device, mirrored to roll_log when signed in.
import { useSyncExternalStore } from "react";
import { isNetworkError, isOnline, onReconnect, Outbox, type OutboxItem } from "./outbox.ts";
import { supabase } from "./supabase.ts";

export interface RollRecord {
  id: string;
  characterId: string;
  at: string;
  kind: "action" | "reaction" | "damage" | "damage-taken" | "rest";
  /** e.g. "Agility + Tracker" or "Shortbow damage" */
  label: string;
  /** e.g. "17 with Hope" */
  summary: string;
  /** dice and modifiers, for the log detail line */
  detail: string;
  applied: string[];
}

const KEY = "dp.rolls.v1";
const SESSION_KEY = "dp.session.v1";
const MAX_PER_CHARACTER = 200;

type Store = { rolls: Record<string, RollRecord[]>; sessions: Record<string, string> };
let store: Store = load();
const listeners = new Set<() => void>();

function load(): Store {
  try {
    return { rolls: JSON.parse(localStorage.getItem(KEY) ?? "{}"), sessions: JSON.parse(localStorage.getItem(SESSION_KEY) ?? "{}") };
  } catch {
    return { rolls: {}, sessions: {} };
  }
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store.rolls));
    localStorage.setItem(SESSION_KEY, JSON.stringify(store.sessions));
  } catch {
    /* in-memory only */
  }
  listeners.forEach((l) => l());
}

/** Add a roll locally, and to roll_log if the character already exists on the server. */
export function logRoll(rec: Omit<RollRecord, "id" | "at">, remote?: { userId: string | null; savedOnServer: boolean }): RollRecord {
  const full: RollRecord = { ...rec, id: crypto.randomUUID(), at: new Date().toISOString() };
  const list = [full, ...(store.rolls[rec.characterId] ?? [])].slice(0, MAX_PER_CHARACTER);
  store = { ...store, rolls: { ...store.rolls, [rec.characterId]: list } };
  save();
  if (remote?.userId && remote.savedOnServer) {
    rollOutbox.add("roll", full.id, full);
    flushRolls();
  }
  return full;
}

/** Roll-log uploads wait here while offline and are retried on reconnect. */
export const rollOutbox = new Outbox("dp.outbox.rolls.v1");

const sendRoll = async (item: OutboxItem) => {
  const r = item.payload as RollRecord;
  const { error } = await supabase.from("roll_log").upsert({ id: r.id, character_id: r.characterId, rolled_at: r.at, payload: r }, { onConflict: "id", ignoreDuplicates: true });
  // a permanent error (e.g. the character was deleted) drops the item instead of blocking the queue
  if (error && isNetworkError(error)) throw error;
};

export function flushRolls() {
  if (isOnline()) rollOutbox.flush(sendRoll).catch(() => {});
}

if (typeof window !== "undefined") onReconnect(flushRolls);

export function startSession(characterId: string) {
  store = { ...store, sessions: { ...store.sessions, [characterId]: new Date().toISOString() } };
  save();
}

export function clearLog(characterId: string) {
  const { [characterId]: _, ...rest } = store.rolls;
  store = { ...store, rolls: rest };
  save();
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export function useRollLog(characterId: string) {
  const s = useSyncExternalStore(subscribe, () => store, () => store);
  const all = s.rolls[characterId] ?? [];
  const since = s.sessions[characterId];
  return { all, session: since ? all.filter((r) => r.at >= since) : all, sessionStart: since ?? null };
}
