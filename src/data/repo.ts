// Thin typed wrappers over the database. Row-level security limits every call to the signed-in user.
import { supabase } from "./supabase.ts";

export type SaveReason = "autosave" | "level-up" | "builder-finish" | "import" | "restore" | "conflict";

export type SaveResult =
  | { status: "ok"; rev: number }
  | { status: "conflict"; rev: number; data: unknown; updated_at: string }
  | { status: "deleted" };

export interface CharacterRow {
  id: string;
  name: string;
  level: number;
  class_id: string | null;
  data: unknown;
  rev: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** Save with optimistic concurrency. baseRev is the rev this device last saw (0 for a new character). */
export async function saveCharacter(args: {
  id: string;
  baseRev: number;
  data: unknown;
  name: string;
  level: number;
  classId: string | null;
  reason?: SaveReason;
}): Promise<SaveResult> {
  const { data, error } = await supabase.rpc("save_character", {
    p_id: args.id,
    p_base_rev: args.baseRev,
    p_data: args.data,
    p_name: args.name,
    p_level: args.level,
    p_class_id: args.classId,
    p_reason: args.reason ?? "autosave",
  });
  if (error) throw error;
  return data as SaveResult;
}

export async function listCharacters(): Promise<CharacterRow[]> {
  const { data, error } = await supabase.from("characters").select("*").is("deleted_at", null).order("updated_at", { ascending: false });
  if (error) throw error;
  return data as CharacterRow[];
}

export async function listVersions(characterId: string) {
  const { data, error } = await supabase
    .from("character_versions")
    .select("id, rev, reason, created_at, data")
    .eq("character_id", characterId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data as { id: number; rev: number; reason: SaveReason; created_at: string; data: unknown }[];
}

const EXPORT_TABLES = ["profiles", "user_settings", "homebrew_packs", "characters", "character_versions", "roll_log"] as const;

/** Everything the user has stored, as one JSON document. */
export async function exportAllData() {
  const { data: auth } = await supabase.auth.getUser();
  const out: Record<string, unknown> = {
    exportedAt: new Date().toISOString(),
    account: auth.user ? { id: auth.user.id, email: auth.user.email, created_at: auth.user.created_at } : null,
  };
  for (const t of EXPORT_TABLES) {
    const { data, error } = await supabase.from(t).select("*");
    if (error) throw error;
    out[t] = data;
  }
  return out;
}

/** Deletes the auth user; every table cascades. Signs out locally afterwards. */
export async function deleteMyAccount() {
  const { error } = await supabase.rpc("delete_my_account");
  if (error) throw error;
  await supabase.auth.signOut({ scope: "local" });
}
