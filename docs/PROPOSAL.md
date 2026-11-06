# Schema and app structure proposal (step 2)

Status: **waiting for approval**, and for the decisions in PROGRESS.md.
Assumes SRD 2.0 (decision D2). If you choose 1.0, only the content pack changes. The schemas stay the same.

Changes from the earlier draft:
- Content ids no longer include the SRD version, so characters survive a pack upgrade.
- Version snapshots are throttled. The old "keep 20 saves" rule would have been wiped out by 20 HP taps.
- Character data now separates builder choices from table state.
- Derived stats are computed, never stored.
- New content types: beastforms, transformations, progression, conditions.
- New: class resources (Favor, Patron Die, and so on).
- New: the Phase 2 homebrew conflict and the Docker gap for RLS tests.

## 1. Stack
| Part | Choice | Why |
|---|---|---|
| UI | React + TypeScript + Vite | Required by the brief. |
| Routing | react-router | Gives every entry its own URL. |
| Schemas | Zod 4 | TS types are inferred from Zod. `z.toJSONSchema()` produces JSON Schema for homebrew authors. |
| Auth + DB | Supabase (Auth, Postgres, RLS) | Free tier covers email/password, magic link, Google, and Discord. No reason to switch. |
| Search | MiniSearch | Small, client-side. The SRD is static. |
| Offline | IndexedDB (via `idb`, ~1 KB) plus a hand-written service worker | Keeps dependencies small. |
| Drag and drop | @dnd-kit/core | Keyboard-accessible drag, needed for trait assignment. |
| Tests | Vitest for rules logic, pgTAP via `npx supabase test db` for RLS | |
| PDF | Print stylesheet plus browser "Save as PDF" first | No PDF library unless that falls short (decision D10). |
| Hosting | Cloudflare Pages, Vercel, or Netlify | All free tier, static build. |

State is held in plain React context with `useSyncExternalStore`. No state library.

## 2. Content data layer (static, bundled)

### Layout
```
content/
  schema/                      Zod schemas + TS types (also used by homebrew importer)
  srd/                         pack id "srd", version "2.0"
    pack.json                  { id, name, version, source doc, attribution, modifications[] }
    raw/srd-2.0.txt            full extracted text, page-marked (@@PDFPAGE n@@)
    raw/sections/<type>.txt    raw text slices per content type, for side-by-side checking
    data/
      classes.json subclasses.json domains.json domain-cards.json
      ancestries.json communities.json transformations.json beastforms.json
      weapons.json armor.json items.json consumables.json loot.json
      adversaries.json environments.json
      progression.json         tiers, tier achievements, advancement options, companion level-up options
      conditions.json glossary.json rules.json
    errata.json                every place our text differs from the PDF (typos), with page
scripts/
  extract-srd.ts   PDF -> raw text
  parse-srd.ts     raw text -> data/*.json
  autotag.ts       tags glossary terms inside text
  validate-packs.ts  schema check, link check, duplicate ids, untagged terms report
```

### Ids
- Format: `<pack>/<type>/<slug>`, e.g. `srd/class/warlock`, `srd/domain-card/book-of-ava`, `hb-9f3c…/weapon/sunblade`.
- Ids carry no SRD version, so a character built on SRD 2.0 keeps working when the pack is updated. The pack's `version` field records which release it is.
- Homebrew packs are add-only: they can't replace an SRD entry. A homebrew entry with the same name gets its own id.

### Shared base
```ts
Source = { kind: "srd" | "pgc" | "homebrew"; document: string; page?: number; pageEnd?: number }
// e.g. { kind: "srd", document: "Daggerheart SRD 2.0", page: 26 }

RichText = string   // light markdown + inline tags:
//   {{term:stress|Stress}}      -> glossary/conditions tooltip + link
//   {{ref:srd/domain/dread}}    -> cross-entry link (label defaults to entry name)

Entry = { id; type; name; pack; source: Source; text?: RichText; tags?: string[] }
```

### Features, with machine-readable parts where the rules are simple
```ts
Feature = {
  name: string
  text: RichText                        // always the full SRD text; the source of truth
  kind?: "passive" | "action" | "reaction" | "hope" | "fear"
  modifiers?: Modifier[]                // drives "+1 Evasion" previews and derived stats
  resources?: Resource[]                // counters on the sheet (Favor, Beastform uses…)
  choices?: Choice[]                    // selections the builder must ask for
}
Modifier = { target: "evasion"|"hp"|"stress"|"hope"|"armorScore"|"majorThreshold"|"severeThreshold"
                    |"proficiency"|`trait:${Trait}`; value: number; when?: "always"|"equipped"|"beastform" }
Resource = { id; name; max: number | "spellcast" | "tier" | ...; start?: number; die?: string; resetOn?: "short-rest"|"long-rest"|"never" }
Choice   = { id; prompt; count: number; options: string[] | { type: EntryType; filter?: {...} } | "free-text" }
```
Only plain, unconditional effects get `modifiers`. Situational effects stay as text. The sheet never acts on rules it can't model; it shows the text.

### Types (main fields)
- **Class**
  - domains: [2 domain ids], startingEvasion, startingHp
  - classItems: string[] (the SRD offers a choice of class items)
  - hopeFeature, classFeatures: Feature[], subclassIds
  - backgroundQuestions, connectionQuestions
  - suggested: { traits, primary, secondary, armor }
- **Subclass**: classId, spellcastTrait | null, foundation[], specialization[], mastery[] (each a Feature list)
- **Domain**: description, icon? (only if extracted from the SRD). The list of classes per domain is derived and checked by the validator.
- **DomainCard**: domainId, level 1–10, cardType ability|spell|grimoire, recallCost, features[]
- **Ancestry**: description, features: [top, bottom] (fixed order, which mixed ancestry needs)
- **Community**: description, adjectives[], feature
- **Transformation**: description, features[] (benefit and drawback), questions[]. Limit of one per PC.
- **Beastform**: tier, category, examples, traitBonus {trait, value}, evasionBonus, attack {range, trait, die, damageType}, advantages: verbs[], features[]
- **Weapon**: tier, category primary|secondary, group standard|magic|combat-wheelchair, trait, range, damage {dice, bonus, type phy|mag}, burden 1|2, feature?
- **Armor**: tier, baseThresholds {major, severe}, baseScore, feature?
- **Item / Consumable / Loot**: roll (table number), rarity/tier where given, text
- **Adversary**:
  - tier, type (bruiser, horde …), hordePerHp?, description, motives
  - difficulty, thresholds {major, severe} | null, hp, stress
  - attack {modifier, name, range, damage}, experiences [{name, bonus}], features[]
- **Environment**: tier, type, description, impulses, difficulty, potentialAdversaries (ids or text), features[]
- **Progression** (one document):
  - tiers → levels
  - tierAchievements per tier
  - advancementOptions {id, text, slotsPerTier, cost: 1|2, fromTier, excludes[]}
  - companionOptions
- **Condition**: name, text
- **GlossaryTerm**: name, aliases[], summary (verbatim SRD sentence, used in tooltips), sectionId, anchor
- **RulesSection**: parentId, order, title, body: RichText, pages. These make up the table of contents.

### Validator checks
- every entry against its schema
- duplicate ids
- every `{{term}}` and `{{ref}}` resolves
- foreign keys resolve (subclass→class, card→domain, class→domains…)
- counts (e.g. 2 subclasses per class, 2 ancestry features)
- text that looks like a glossary term but isn't tagged (warning)
- every entry has `source.page`

It runs over the SRD pack in CI and over a homebrew pack at import time. Homebrew entries may reference SRD ids.

## 3. Character document (one JSON blob, Zod-validated, `schemaVersion` + migrations)
```ts
Character = {
  schemaVersion: 1
  id: uuid                      // made on the client so offline creation works
  packs: string[]               // enabled packs for this character
  identity: { name, pronouns, description: {...} }
  build: {                      // builder answers; only entry ids, never copied text
    classId, subclassId
    ancestry: { kind: "single", id } | { kind: "mixed", topFrom: id, bottomFrom: id, label? }
    communityId, transformationId?
    traits: Record<Trait, -1|0|1|2>         // the base +2,+1,+1,+0,+0,-1 spread
    gear: { primary?, secondary?, armor?, classItem, startingItems[], gold }
    experiences: [{ id, name, bonus }]
    background: [{ question, answer }]; connections: [{ question, answer }]
    startingCards: [cardId, cardId]
    featureChoices: Record<choiceId, value>   // e.g. warlock sphere, companion
  }
  levelUps: LevelUp[]           // append-only, one per level from 2; undo = drop the last one
  state: {                      // table play state
    hp, stress, hope, armorMarked, scars
    loadout: cardId[], vault: cardId[]
    activeWeapons, inventoryWeapons, armorId
    inventory: [{ entryId? | name, qty, notes }], gold: { handfuls, bags, chests }
    resources: Record<resourceId, number>
    conditions: [{ id, on }], effects: [{ label, on, modifiers? }]
    beastformId?, rests: { short: n, long: n }
  }
  notes: { session, background, connections }
}
LevelUp = { level, tierAchievement?, advancements: [{ optionId, detail }], thresholdsBump: true, domainCard, exchange? }
```
- Derived values (evasion, thresholds, max HP and Stress, proficiency, tier, trait totals) come from the pure function `derive(character, packs)`. They are never stored, so a pack fix or a rollback updates everything.
- Level-up rules (slots, the two-cost options, multiclass cross-outs, trait marks clearing each tier, card level ≤ level, multiclass ≤ half level) live in `rules/levelup.ts`. The wizard only offers moves that pass `canApply()`.

## 4. Database (Supabase Postgres, migrations in `supabase/migrations/`)
Every table has RLS enabled.
- **Owner policy**: select, insert, update, and delete only where `user_id = auth.uid()`, with the same `with check` on writes.
- **Grants**: the `anon` role gets nothing.
- **Defaults**: `user_id` defaults to `auth.uid()`. Foreign keys to `auth.users` use `on delete cascade`.

| Table | Columns | Notes |
|---|---|---|
| `profiles` | id pk = auth.users.id, display_name, created_at | Created by a trigger on signup. Used in Phase 2. |
| `user_settings` | user_id pk, theme, dice jsonb, default_packs text[], updated_at | Default packs for new characters. |
| `homebrew_packs` | id uuid, user_id, name, version, schema_version, data jsonb, created_at, updated_at | Check `octet_length(data::text) < 2 MB`. Validated on the client. |
| `characters` | id uuid (client-made), user_id, name, level, class_id, data jsonb, rev int, created_at, updated_at, deleted_at | name, level, and class_id copied out for the list view. Soft delete gives offline sync a tombstone. |
| `character_versions` | id bigserial, character_id, user_id, rev, reason, data, created_at | reason: autosave, level-up, builder-finish, import, restore. A trigger keeps the newest 20 per character. |
| `roll_log` | id uuid (client-made), character_id, user_id, rolled_at, payload jsonb | Insert-only (no conflicts). Trigger keeps the newest 500 per character. |

RPCs:
- **`save_character(id, base_rev, data, reason)`**, security invoker so RLS still applies. If `base_rev` matches, it updates and bumps `rev`. It also writes a version when `reason ≠ autosave`, or when the last version is more than 10 minutes old (decision D8). Otherwise it returns `{conflict, server_row}`.
- **`delete_my_account()`**, security definer. Deletes `auth.users where id = auth.uid()`; everything else cascades.
- Data export is done on the client by reading every table, so RLS limits it to the user's own rows.

RLS tests (pgTAP in `supabase/tests/`) cover:
- user B can't select, update, delete, or insert-as-A on every table
- the `anon` role can't read anything
- the RPCs respect ownership

### Phase 2 (designed, not built)
Tables:
- `campaigns` (id, owner_id, name, fear int, gm_notes)
- `campaign_members` (campaign_id, user_id, role gm|player)
- `campaign_invites` (campaign_id, token_hash, expires_at, max_uses, uses)
- `campaign_characters` (campaign_id, character_id, shared_by)
- `encounters` (campaign_id, data jsonb, i.e. adversary and environment instances with HP and Stress marks)

Access:
- Security-definer helpers `is_member(cid)` and `is_gm(cid)`.
- One extra select policy on `characters`: "GM of a campaign this character is linked to".
- Invites are redeemed by an RPC, never by a direct table write.
- Adding Phase 2 changes no Phase 1 columns.

**Conflict:** a GM viewing a sheet that uses homebrew would see homebrew text, but brief rule 5 says homebrew is never shown to other users (decision D6).

## 5. App structure
```
src/
  rules/        pure TS, no React: derive, traits, damage, dice, loadout, rest, levelup, builder-validate (+ tests)
  content/      pack loader, registry (id lookup), search index (worker), RichText renderer, term tooltip
  data/
    supabase.ts   client (env: VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)
    local.ts      IndexedDB stores: characters, outbox, rolls, settings, homebrew
    sync.ts       outbox flush, rev conflicts, "saved / saving / offline / conflict" status
    repo/         characters, homebrew, settings, account (export/delete)
  features/
    auth/ compendium/ builder/ levelup/ sheet/ dice/ homebrew/ account/ legal/
  ui/           Tracker (tap-to-mark, aria), Drawer, Tabs, TermLink, Toast, theme tokens (light/dark)
  routes.tsx
supabase/ migrations/ tests/ config.toml
docs/ SETUP.md LICENSE-NOTES.md PROPOSAL.md
```

Routes:

| Route | Page | Access |
|---|---|---|
| `/` | Home | Public |
| `/compendium?q=&type=&tier=&domain=&class=&source=` | Search | Public |
| `/compendium/:pack/:type/:slug` | Entry | Public; homebrew entries only for their owner |
| `/rules/:section` | Rules pages with TOC | Public |
| `/build/:id?/:step` | Builder | Guests: draft saved in IndexedDB, uploaded on signup |
| `/characters` | Character list | Login |
| `/characters/:id` | Sheet | Login |
| `/characters/:id/level-up` | Level-up wizard | Login |
| `/characters/:id/history` | Version history | Login |
| `/characters/:id/print` | Print / PDF | Login |
| `/homebrew` | Homebrew packs | Login |
| `/account` | Account | Login |
| `/auth/*` | Sign in, sign up, reset, verify | Public |
| `/legal` | Attribution and terms | Public |

Offline and sync:
- The service worker precaches the app shell and SRD JSON.
- Every sheet change is written to IndexedDB first (survives a tab close), then queued in the outbox and flushed with `save_character`. It flushes immediately when online and again on `visibilitychange` and `online` events.
- On a conflict, the user sees both versions side by side (derived summary plus a diff of changed fields) and picks one. The other version is kept in history.

## 6. Build order (from the brief)
1. Data layer and validator
2. Auth and database schema with RLS tests
3. Compendium
4. Builder
5. Sheet
6. Dice and trackers
7. Sync and offline cache
8. PDF export

`rules/` tests are written alongside stages 4–6.
