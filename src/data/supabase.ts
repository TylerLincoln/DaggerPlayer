import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/** False when the env vars are missing: the compendium still works, accounts don't. */
export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "missing-anon-key", {
  auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

/** Where auth emails and OAuth providers send the user back to. */
export const authRedirect = (path = "/auth/callback") => `${window.location.origin}${path}`;
