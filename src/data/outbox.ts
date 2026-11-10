// A persistent queue of writes that couldn't be sent (offline, server error). Flushed when the
// connection comes back. Character saves don't go through here: the character store keeps them
// dirty and re-sends the latest copy (see characters.ts); this is for append-only writes like rolls.
import { useSyncExternalStore } from "react";

export interface OutboxItem {
  id: string;
  kind: "roll";
  payload: unknown;
  attempts: number;
  queuedAt: string;
}

export type Sender = (item: OutboxItem) => Promise<void>;

export class Outbox {
  private items: OutboxItem[];
  private flushing = false;
  private listeners = new Set<() => void>();

  constructor(
    private storageKey: string,
    private storage: Pick<Storage, "getItem" | "setItem"> | null = typeof localStorage !== "undefined" ? localStorage : null,
  ) {
    try {
      this.items = JSON.parse(this.storage?.getItem(storageKey) ?? "[]");
    } catch {
      this.items = [];
    }
  }

  get pending(): readonly OutboxItem[] {
    return this.items;
  }

  add(kind: OutboxItem["kind"], id: string, payload: unknown) {
    if (this.items.some((i) => i.id === id)) return;
    this.items = [...this.items, { id, kind, payload, attempts: 0, queuedAt: new Date().toISOString() }];
    this.persist();
  }

  /** Send items in order; stop at the first failure (it is retried on the next flush). */
  async flush(send: Sender): Promise<number> {
    if (this.flushing) return 0;
    this.flushing = true;
    let sent = 0;
    try {
      while (this.items.length) {
        const item = this.items[0];
        try {
          await send(item);
        } catch {
          this.items = [{ ...item, attempts: item.attempts + 1 }, ...this.items.slice(1)];
          this.persist();
          break;
        }
        this.items = this.items.slice(1);
        sent++;
        this.persist();
      }
    } finally {
      this.flushing = false;
    }
    return sent;
  }

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  private persist() {
    try {
      this.storage?.setItem(this.storageKey, JSON.stringify(this.items));
    } catch {
      /* in memory only */
    }
    this.listeners.forEach((l) => l());
  }
}

// ---------- connection status ----------

let online = typeof navigator === "undefined" ? true : navigator.onLine;
const netListeners = new Set<() => void>();
if (typeof window !== "undefined") {
  window.addEventListener("online", () => ((online = true), netListeners.forEach((l) => l())));
  window.addEventListener("offline", () => ((online = false), netListeners.forEach((l) => l())));
}

export const isOnline = () => online;

export function useOnline(): boolean {
  return useSyncExternalStore(
    (l) => {
      netListeners.add(l);
      return () => netListeners.delete(l);
    },
    () => online,
    () => true,
  );
}

/** Call `fn` whenever the connection comes back. */
export function onReconnect(fn: () => void): () => void {
  const l = () => online && fn();
  netListeners.add(l);
  return () => netListeners.delete(l);
}

/** True for errors that mean "couldn't reach the server" rather than "the server said no". */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
  return !online || /Failed to fetch|NetworkError|Load failed|network|fetch failed|ERR_INTERNET/i.test(msg);
}
