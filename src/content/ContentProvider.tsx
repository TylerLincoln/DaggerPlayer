// Loads the enabled content packs and exposes a registry + search index.
// Visitors' pack choice is kept in localStorage; signed-in users' in user_settings.default_packs.
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { supabase } from "../data/supabase.ts";
import { useAuth } from "../features/auth/AuthProvider.tsx";
import { bundledPacks, loadEntries } from "./packs.ts";
import { Registry } from "./registry.ts";
import { SearchIndex } from "./search.ts";

interface ContentState {
  registry: Registry | null;
  search: SearchIndex | null;
  enabledPacks: string[];
  setPackEnabled: (id: string, on: boolean) => void;
}

export const ContentContext = createContext<ContentState>({ registry: null, search: null, enabledPacks: [], setPackEnabled: () => {} });

const STORAGE_KEY = "dp.packs";
const defaults = () => bundledPacks.filter((p) => p.defaultEnabled).map((p) => p.id);

function readLocal(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return Array.isArray(v) ? v : defaults();
  } catch {
    return defaults();
  }
}

/** A pack is only usable with the packs it requires. */
function withRequirements(ids: string[]): string[] {
  const out = new Set(ids);
  for (const p of bundledPacks) if (out.has(p.id)) p.requires.forEach((r) => out.add(r));
  return [...out].filter((id) => bundledPacks.some((p) => p.id === id));
}

export function ContentProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [enabledPacks, setEnabled] = useState<string[]>(() => withRequirements(readLocal()));
  const [registry, setRegistry] = useState<Registry | null>(null);

  // signed in: take the account's default packs
  useEffect(() => {
    if (!user) return;
    supabase
      .from("user_settings")
      .select("default_packs")
      .maybeSingle()
      .then(({ data }) => {
        if (data?.default_packs) setEnabled(withRequirements(data.default_packs));
      });
  }, [user]);

  useEffect(() => {
    let cancelled = false;
    const packs = bundledPacks.filter((p) => enabledPacks.includes(p.id));
    loadEntries(enabledPacks).then((entries) => {
      if (!cancelled) setRegistry(new Registry(entries, packs));
    });
    return () => {
      cancelled = true;
    };
  }, [enabledPacks]);

  const setPackEnabled = useCallback(
    (id: string, on: boolean) => {
      setEnabled((cur) => {
        // the base SRD pack can't be switched off while something requires it
        const next = withRequirements(on ? [...cur, id] : cur.filter((p) => p !== id && !bundledPacks.find((b) => b.id === p)?.requires.includes(id)));
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
        } catch {
          /* storage unavailable: keep in memory */
        }
        if (user) supabase.from("user_settings").update({ default_packs: next }).eq("user_id", user.id).then(() => {});
        return next;
      });
    },
    [user],
  );

  const search = useMemo(() => (registry ? new SearchIndex(registry) : null), [registry]);

  return <ContentContext.Provider value={{ registry, search, enabledPacks, setPackEnabled }}>{children}</ContentContext.Provider>;
}

export const useContent = () => useContext(ContentContext);
