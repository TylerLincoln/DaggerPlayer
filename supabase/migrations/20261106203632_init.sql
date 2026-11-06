-- DaggerPlayer initial schema (Phase 1).
-- Only user data lives here; rules content is bundled with the app.
-- Every table has row-level security: a user can only touch rows where user_id = auth.uid().
-- Rebuild from scratch with: npx supabase db reset (local) or apply in order to a new project.

-- ---------------------------------------------------------------------------
-- helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (char_length(display_name) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on public.profiles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- user settings (theme, dice options, packs enabled by default for new characters)
-- ---------------------------------------------------------------------------

create table public.user_settings (
  user_id uuid primary key default auth.uid() references auth.users (id) on delete cascade,
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  dice jsonb not null default '{}'::jsonb,
  default_packs text[] not null default array['srd'],
  updated_at timestamptz not null default now()
);

create trigger user_settings_updated_at before update on public.user_settings
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- homebrew packs (validated on the client against the same schemas as bundled packs)
-- ---------------------------------------------------------------------------

create table public.homebrew_packs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  version text not null default '1' check (char_length(version) <= 40),
  schema_version int not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint homebrew_packs_size check (octet_length(data::text) < 2 * 1024 * 1024)
);

create index homebrew_packs_user on public.homebrew_packs (user_id);
create trigger homebrew_packs_updated_at before update on public.homebrew_packs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- characters
-- id is generated on the client so characters can be created offline.
-- rev increases by one on every update (enforced by trigger) and drives conflict detection.
-- deleted_at is a soft delete so offline devices see a tombstone.
-- ---------------------------------------------------------------------------

create table public.characters (
  id uuid primary key,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null default '' check (char_length(name) <= 120),
  level int not null default 1 check (level between 1 and 10),
  class_id text check (char_length(class_id) <= 200),
  data jsonb not null,
  rev int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint characters_size check (octet_length(data::text) < 1024 * 1024)
);

create index characters_user_updated on public.characters (user_id, updated_at desc);

create or replace function public.characters_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.rev := old.rev + 1;
  new.updated_at := now();
  new.created_at := old.created_at;
  return new;
end;
$$;

create trigger characters_before_update before update on public.characters
  for each row execute function public.characters_before_update();

-- ---------------------------------------------------------------------------
-- character versions: snapshots for rollback; the newest 20 per character are kept
-- ---------------------------------------------------------------------------

create table public.character_versions (
  id bigint generated always as identity primary key,
  character_id uuid not null references public.characters (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rev int not null,
  reason text not null check (reason in ('autosave', 'level-up', 'builder-finish', 'import', 'restore', 'conflict')),
  data jsonb not null,
  created_at timestamptz not null default now()
);

create index character_versions_character on public.character_versions (character_id, created_at desc, id desc);

create or replace function public.prune_character_versions()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.character_versions v
  where v.character_id = new.character_id
    and v.id not in (
      select k.id from public.character_versions k
      where k.character_id = new.character_id
      order by k.created_at desc, k.id desc
      limit 20
    );
  return null;
end;
$$;

create trigger character_versions_prune after insert on public.character_versions
  for each row execute function public.prune_character_versions();

-- ---------------------------------------------------------------------------
-- roll log: insert-only, newest 500 per character kept
-- ---------------------------------------------------------------------------

create table public.roll_log (
  id uuid primary key,
  character_id uuid not null references public.characters (id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  rolled_at timestamptz not null default now(),
  payload jsonb not null,
  constraint roll_log_size check (octet_length(payload::text) < 16 * 1024)
);

create index roll_log_character on public.roll_log (character_id, rolled_at desc);

create or replace function public.prune_roll_log()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.roll_log r
  where r.character_id = new.character_id
    and r.id not in (
      select k.id from public.roll_log k
      where k.character_id = new.character_id
      order by k.rolled_at desc
      limit 500
    );
  return null;
end;
$$;

create trigger roll_log_prune after insert on public.roll_log
  for each row execute function public.prune_roll_log();

-- ---------------------------------------------------------------------------
-- row-level security
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.user_settings enable row level security;
alter table public.homebrew_packs enable row level security;
alter table public.characters enable row level security;
alter table public.character_versions enable row level security;
alter table public.roll_log enable row level security;

-- signed-out visitors get no table access at all (they use the compendium and a local-only builder)
revoke all on public.profiles, public.user_settings, public.homebrew_packs, public.characters,
  public.character_versions, public.roll_log from anon;

-- profiles: rows are created by the signup trigger; users read and edit their own
create policy "own profile: select" on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy "own profile: update" on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- user settings
create policy "own settings: select" on public.user_settings for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own settings: insert" on public.user_settings for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own settings: update" on public.user_settings for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- homebrew packs
create policy "own homebrew: select" on public.homebrew_packs for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own homebrew: insert" on public.homebrew_packs for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own homebrew: update" on public.homebrew_packs for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own homebrew: delete" on public.homebrew_packs for delete to authenticated
  using (user_id = (select auth.uid()));

-- characters
create policy "own characters: select" on public.characters for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own characters: insert" on public.characters for insert to authenticated
  with check (user_id = (select auth.uid()));
create policy "own characters: update" on public.characters for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "own characters: delete" on public.characters for delete to authenticated
  using (user_id = (select auth.uid()));

-- versions: immutable (no update policy); inserts must point at the caller's own character
create policy "own versions: select" on public.character_versions for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own versions: insert" on public.character_versions for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid()))
  );
create policy "own versions: delete" on public.character_versions for delete to authenticated
  using (user_id = (select auth.uid()));

-- roll log: immutable; inserts must point at the caller's own character
create policy "own rolls: select" on public.roll_log for select to authenticated
  using (user_id = (select auth.uid()));
create policy "own rolls: insert" on public.roll_log for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.characters c where c.id = character_id and c.user_id = (select auth.uid()))
  );
create policy "own rolls: delete" on public.roll_log for delete to authenticated
  using (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- new user: create profile and settings rows
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'), 80));
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- save_character: optimistic concurrency + version snapshots (decision D8)
--   p_base_rev = the rev the client last saw (0 for a brand-new character).
--   Returns {status: "ok", rev} | {status: "conflict", rev, data, updated_at} | {status: "deleted"}.
--   A snapshot is written for any non-autosave reason, or when the last one is over 10 minutes old.
-- Runs as the caller, so row-level security still applies.
-- ---------------------------------------------------------------------------

create or replace function public.save_character(
  p_id uuid,
  p_base_rev int,
  p_data jsonb,
  p_name text,
  p_level int,
  p_class_id text,
  p_reason text default 'autosave'
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  cur public.characters;
  new_rev int;
  last_snap timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;

  select * into cur from public.characters where id = p_id for update;

  if not found then
    if p_base_rev <> 0 then
      -- the client thinks this character exists on the server but it doesn't (hard-deleted)
      return jsonb_build_object('status', 'deleted');
    end if;
    insert into public.characters (id, name, level, class_id, data)
    values (p_id, coalesce(p_name, ''), coalesce(p_level, 1), p_class_id, p_data)
    returning rev into new_rev;
  else
    if cur.deleted_at is not null then
      return jsonb_build_object('status', 'deleted');
    end if;
    if cur.rev <> p_base_rev then
      return jsonb_build_object('status', 'conflict', 'rev', cur.rev, 'data', cur.data, 'updated_at', cur.updated_at);
    end if;
    update public.characters
      set data = p_data, name = coalesce(p_name, ''), level = coalesce(p_level, 1), class_id = p_class_id
      where id = p_id
      returning rev into new_rev;
  end if;

  select max(created_at) into last_snap from public.character_versions where character_id = p_id;
  if p_reason <> 'autosave' or last_snap is null or last_snap < now() - interval '10 minutes' then
    insert into public.character_versions (character_id, rev, reason, data) values (p_id, new_rev, p_reason, p_data);
  end if;

  return jsonb_build_object('status', 'ok', 'rev', new_rev);
end;
$$;

revoke execute on function public.save_character(uuid, int, jsonb, text, int, text, text) from public, anon;
grant execute on function public.save_character(uuid, int, jsonb, text, int, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- delete_my_account: removes the auth user; every table cascades from auth.users
-- ---------------------------------------------------------------------------

create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  me uuid := (select auth.uid());
begin
  if me is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  delete from auth.users where id = me;
end;
$$;

revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- trigger functions are not meant to be called directly
revoke execute on function public.set_updated_at(), public.characters_before_update(),
  public.prune_character_versions(), public.prune_roll_log() from public, anon, authenticated;
