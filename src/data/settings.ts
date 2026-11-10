// User settings (theme, dice options). Kept in localStorage; synced to user_settings when signed in.
import { useEffect, useSyncExternalStore } from "react";
import { supabase } from "./supabase.ts";

export interface Settings {
  theme: "system" | "light" | "dark";
  dice: {
    /** apply roll results (gain Hope, clear Stress on a crit) automatically */
    autoApply: boolean;
    /** optional Massive Damage rule (SRD p. 50) */
    massiveDamage: boolean;
  };
}

const DEFAULTS: Settings = { theme: "system", dice: { autoApply: true, massiveDamage: false } };
const KEY = "dp.settings.v1";
let settings: Settings = load();
const listeners = new Set<() => void>();
let signedInUser: string | null = null;

function load(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "null");
    return raw ? { ...DEFAULTS, ...raw, dice: { ...DEFAULTS.dice, ...raw.dice } } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

function emit() {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l());
}

export function updateSettings(patch: { theme?: Settings["theme"]; dice?: Partial<Settings["dice"]> }) {
  settings = { ...settings, ...patch, dice: { ...settings.dice, ...patch.dice } };
  emit();
  if (signedInUser) supabase.from("user_settings").update({ theme: settings.theme, dice: settings.dice }).eq("user_id", signedInUser).then(() => {});
}

export function useSettings(): Settings {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => settings,
    () => settings,
  );
}

/** Mount once: loads the account's settings on sign-in and applies the theme to <html>. */
export function useSettingsSync(userId: string | null) {
  const s = useSettings();
  useEffect(() => {
    signedInUser = userId;
    if (!userId) return;
    supabase
      .from("user_settings")
      .select("theme, dice")
      .maybeSingle()
      .then(({ data }) => {
        if (!data) return;
        settings = { theme: (data.theme as Settings["theme"]) ?? settings.theme, dice: { ...DEFAULTS.dice, ...settings.dice, ...(data.dice as object) } };
        emit();
      });
  }, [userId]);
  useEffect(() => {
    const el = document.documentElement;
    if (s.theme === "system") el.removeAttribute("data-theme");
    else el.setAttribute("data-theme", s.theme);
  }, [s.theme]);
}
