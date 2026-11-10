# Progress

## Done
- Step 1: license review. Notes in docs/LICENSE-NOTES.md.
- Step 2: proposal in docs/PROPOSAL.md, approved 2026-11-06.
- **Stage 1: data layer and validator** (details in docs/CONTENT.md).
  - **Extractor** (`scripts/extract-srd.ts`, pdfjs-dist). Keeps:
    - table cells
    - bold/italic
    - heading font
    - the digits the PDF sets in a symbol font (adversary tiers, horde sizes)
  - **Parser** (`scripts/parse-srd.ts` + `scripts/parse/*`). The `srd` pack has 1,446 entries:

    | Type | Count |
    |---|---|
    | Classes | 13 |
    | Subclasses | 26 |
    | Domains | 10 |
    | Domain cards | 210 |
    | Ancestries | 24 |
    | Communities | 15 |
    | Transformations | 6 |
    | Beastforms | 24 |
    | Weapons | 315 |
    | Armor | 69 |
    | Items | 120 |
    | Consumables | 120 |
    | Adversaries | 258 |
    | Environments | 47 |
    | Conditions | 3 |
    | Progression | 1 |
    | Glossary terms | 55 |
    | Rules sections | 130 |

    The optional `srd-frames` pack has 55 rules sections.
  - **Rules terms** are tagged in all text: 6,456 `{{term:…}}` links to 55 glossary terms in the `srd` pack. Each term's tooltip is a verbatim SRD sentence.
  - **Validator** (`content/validate.ts`, CLI `npm run content:validate`) checks:
    - schema
    - ids
    - duplicates
    - cross-links
    - term/ref tags
    - pack dependencies

    It's written so the homebrew importer can reuse it.
  - **JSON Schema** for homebrew authors: `content/schema/pack.schema.json`.
  - **Errata**: 2 so far, listed in `content/srd/errata.json`.
  - **Tests**: 23 (`npm test`):
    - completeness counts
    - spot checks against the PDF
    - the validator rejecting broken homebrew
  - **Placeholder page** (`npm run dev -- --host`): lists the bundled packs, to show they load. `npm run build` passes.

## Next
- **Stage 2: auth and database schema.** Done, and live on the hosted project (`DaggerPlayer`).
  - `supabase/migrations/…_init.sql`, pushed 2026-11-06 with the owner's OK:
    - tables: profiles, user_settings, homebrew_packs, characters, character_versions, roll_log
    - RLS on every table; `anon` has no table or function access (checked against the live API: 401)
    - `save_character` RPC: rev-based conflict detection, version snapshots per D8, versions capped at 20, rolls at 500
    - `delete_my_account` RPC
  - Migration logic was smoke-tested in PGlite (scratch only, not committed). RLS isn't tested (D9).
  - Hosted auth config, set through the Management API:
    - Site URL: the Codespaces URL
    - redirect URLs: the Codespaces URL plus localhost:5173
    - minimum password length 8
    - secure password change on
  - App: sign up, sign in (password, magic link, Google, Discord), email verification, password reset, sign out. Account page: change email, change password, export data as JSON, delete account. Legal/attribution page; attribution footer on every page.
  - docs/SETUP.md: project setup, env vars, OAuth providers, run, deploy.
  - Owner tested 2026-11-06: magic-link sign-in works end to end on the Codespaces URL.
  - Google sign-in enabled 2026-11-10: OAuth client in Google Cloud (Testing mode, test users only), keys added in the Supabase dashboard; the API check passed (redirects to Google with the correct callback). Owner confirmed end-to-end sign-in works (2026-11-10).
  - **Still needs the owner:** Discord OAuth app (keys go in the dashboard). Until then those two buttons return an error.
- **Stage 3: compendium.** Done.
  - **Search** (`/compendium`): full-text across enabled packs with MiniSearch (prefix and typo tolerant). Filters: type, tier, domain, class, source. Query and filters live in the URL, so searches can be shared and bookmarked.
  - **Entry pages:** every entry has its own URL (`/compendium/<pack>/<type>/<slug>`). Each type has a view (class, subclass, domain with card list, domain card, ancestry, community, transformation, beastform, weapon, armor, item, consumable, adversary and environment stat blocks, condition, glossary term, leveling with slot table) and shows its source page.
  - **Cross-links:** domain card ↔ domain ↔ classes, class ↔ subclasses, glossary term → rules section.
  - **Rules reader** (`/rules`, `/rules/<pack>/<slug>`): table of contents (sticky sidebar on wide screens), breadcrumbs, subsections, previous/next in book order.
  - **Rules terms:** dotted-underline links with a tooltip on hover or keyboard focus (Escape closes). On touch, the first tap shows the tooltip and the second opens the entry.
  - **Pack toggle:** the frames pack can be switched on and off. The choice is saved in `user_settings.default_packs` when signed in, otherwise in localStorage.
  - **Domain icons (D12):** extracted from SRD p. 7 by `npm run content:icons` (needs poppler-utils, now in the devcontainer's postCreateCommand). They're stored as alpha masks and tinted with the text colour, so they work in light and dark mode.
  - **Tests (35):** every entry and all 185 rules pages render through the real components with no unresolved tags; search, filters and markdown parsing are covered.
  - Not yet:
    - Homebrew entries in the compendium: the registry supports them; they arrive with the homebrew importer.
    - Route-level code splitting: the main bundle is 598 KB (174 KB gzipped).
    - A manual browser pass by the owner.
- **Stage 4: character builder and level-up wizard.** Done.
  - **Rules engine** (`src/rules/`, pure TS):
    - character document schema
    - `derive()`: every sheet number with a breakdown of its sources, plus the SRD caps (HP/Stress 12, Hope 6, Armor Score 12)
    - trait spread
    - builder validation by step
    - starting sheet (SRD pp. 4–5)
    - level-up rules: slot ledger per tier, crossed-out options, trait marks, card level limits, multiclass, exchange, undo
  - **Feature modifiers.** Curated permanent effects (ancestry, subclass, cards) are in `content/srd/modifiers.json`. Equipment modifiers are parsed from feature text (e.g. "−1 to Evasion"). Clank's Purposeful Design is modelled as a choice.
  - **Builder** (`/build/:id/:step`):
    - eight steps, with a progress bar and free jumping between steps
    - a details drawer with the full SRD text and a Choose button
    - "+1 Evasion"-style previews on every option
    - traits by tap-to-assign or drag-and-drop (keyboard works through the tap buttons)
    - mixed ancestry
    - an optional transformation (GM approval)
    - a review step listing everything still missing, linked to its step
  - **Level-up wizard** (`/characters/:id/level-up`): the four SRD steps, slot counts, reasons for blocked options, inline picks, a preview, and undo of the last level-up.
  - **Characters page:** local drafts (guests can build without an account), autosave to the account when signed in (`save_character`, snapshot on finish and level-up), a conflict banner, and single-character JSON export/import (imports get a new id).
  - **Tests (72):**
    - trait math, thresholds (armored and unarmored), modifiers, caps, mixed ancestry
    - builder validation rules
    - level-up limits: slots, crossing out, trait marks, card limits, exchange, loadout→vault, undo, HP cap
    - server-rendered builder and level-up pages
  - **Not yet:**
    - The play sheet (stage 5): `/characters/:id` shows a summary for now.
    - Domain cards with a choice (e.g. Vitality: "two of the following") have no machine-readable effect yet; the sheet stage needs them.
    - Class-feature selections (warlock patron, ranger companion, …) are a free-text note.
    - Only the primary subclass can take upgraded cards. SRD p. 54 says "the next card for your subclass".
    - Resolving a conflict with "keep this device's" overwrites the server copy without snapshotting it first. Stage 7 adds that.
    - A browser pass by the owner.
- **Import kit** (`docs/import/`, `npm run import-kit`): character JSON Schema, a valid template character, every content id, and a prompt for converting an existing sheet with Claude.
- **Stage 5: character sheet** (`/characters/:id`). Done.
  - **Rules** (`src/rules/sheet.ts`, `dice.ts`):
    - Stress overflow → 1 HP; last Stress → Vulnerable; last HP → death-move prompt
    - Hope cap (6 − scars); Armor Slots ≤ Armor Score (none when unarmored)
    - loadout/vault with Recall Cost (free while resting) and swap-out when full
    - weapon swaps (free in calm, 1 Stress otherwise; burden rules; tier limit)
    - gold carry (10/10, max 1 chest); consumables max 5
    - short/long rests with downtime moves (1d4 + tier; long rests clear everything), three short rests force a long one, rest-limited effects expire
  - **UI:** tabs Play / Cards / Gear / Features / Story, with sections and URL state.
    - Stat boxes with a tap-to-open breakdown.
    - Threshold bands (Minor / Major / Severe).
    - Traits; Spellcast trait.
    - Read-only box trackers.
    - Experiences with totals.
    - Weapons with computed damage dice (Proficiency × die + bonus).
    - Conditions (Vulnerable shown automatically when Stress is full) and temporary effects with expiry.
    - Inventory counters, gold, a rest dialog, undo level-up.
    - Rules terms on the sheet are links with tooltips. Rule refusals and their reasons are shown as messages.
  - **Tests (90 total):** sheet rules, and every sheet tab rendered for the import template character.
  - **Not yet (stage 6):** tap-to-mark trackers, damage input against thresholds with the Armor Slot offer, the duality dice roller, rolling from traits/weapons/Experiences, roll history.
- **Stage 6: dice and trackers.** Done.
  - **Rules** (`src/rules/duality.ts`):
    - Duality Dice: Hope/Fear/crit; outcome with or without a Difficulty; a crit always succeeds.
    - Advantage and disadvantage cancel one for one, with at most one die. Help an Ally: the highest advantage die counts.
    - Experiences cost 1 Hope each.
    - Reaction rolls generate no Hope or Fear, and a crit on one doesn't clear Stress.
    - Applying a result: with Hope → +1 Hope; crit → +1 Hope and clear 1 Stress.
    - Damage rolls: Proficiency × die + bonus; crit adds the dice maximum.
    - Damage taken: resistance halves (rounded up, p. 53) → thresholds → one Armor Slot drops severity a step (not for direct damage) → mark HP. Optional Massive Damage. Immunity.
    - The tests reproduce the SRD's own examples ("13 with Fear", Anne's 18 with Hope, 2d8+1+16).
  - **UI:**
    - Tap-to-mark HP / Stress / Hope / Armor Slot boxes. Each box is a labelled button with aria-pressed, plus −/+ buttons. Overflow and Vulnerable rules still apply.
    - Roll from any trait, from an Experience (spends a Hope) or from a weapon (attack, then damage; critical damage on a crit).
    - Floating Roll / Reaction buttons.
    - Damage input with a live preview.
    - Log tab: session roll history with "start a new session", mirrored to `roll_log` when signed in.
    - Settings (theme, auto-apply results, Massive Damage) on the Account page and at `/settings`; synced to `user_settings`.
  - **Tests:** 103 in total.
- **Stage 7: sync and offline cache.** Done.
  - **Local-first.** Every change is written to this device synchronously (localStorage), so closing the tab mid-edit loses nothing. *Deviation from the proposal:* characters stay in localStorage rather than IndexedDB, because IndexedDB writes are asynchronous and can be cut off when a tab closes. Characters are ~20 KB, well within limits.
  - **Autosave:**
    - debounced `save_character` with rev checks
    - an **Offline** status when the network is unreachable; changes stay queued and retry on reconnect and every 20 s
    - flushes when the tab is hidden
    - opening a character pulls a newer server copy when there are no local edits
  - **Outbox** (`src/data/outbox.ts`): a persistent queue for roll-log uploads; sends in order, stops at the first failure, retries on reconnect.
  - **Two-device conflicts:** a side-by-side table of what differs (HP, Stress, Hope, loadout, inventory, gold, level, …) and a choice of version. The discarded version is first saved to the history, so the choice can be undone.
  - **History page** (`/characters/:id/history`): the last 20 versions with reason and time, a comparison with the current one, and restore (the current state is snapshotted first).
  - **Service worker** (`public/sw.js`, production builds only): the app shell is network-first with an offline fallback; hashed assets (code, content packs, icons) are cache-first. Supabase calls are never cached. Offline banner in the header.
  - **Tests:** 111 in total (outbox ordering/retry/persistence, version comparison).
  - **Not verified here (no browser):** the service worker in a real browser. See docs/SETUP.md, "Test offline mode".
- **Stage 8: PDF export.** Done (D10: print stylesheet + the browser's Save as PDF).
  - **`/characters/:id/print`** ("Print / PDF" on the sheet) contains:
    - identity; core stats; threshold bands; HP/Stress/Hope/Armor boxes as currently marked; traits; Experiences
    - weapons with damage rolls; armor; inventory; gold; conditions
    - the full text of every loadout and vault card and every feature
    - background, connections, notes
    - the **DPCGL attribution and modification statement** (required on Shared material, §4.1)
  - **Print CSS:** app chrome hidden, black on white, cards and features kept whole across pages, filled boxes print (with "Background graphics" on). The page title becomes the PDF file name.
  - **Tests:** 116 in total (sections, tracker marks, attribution, plain-text terms).
  - **Not verified here (no browser):** the actual print preview and page breaks.

## All build stages are done. Still open across the project

Not built yet:
- **Homebrew importer: tabled by the owner (2026-11-10).** It's in the brief (content rule 5) but not in the build order. The schemas, validator (`content/validate.ts`), JSON Schema and DB table (`homebrew_packs`) are ready; the upload/manage UI and loading homebrew packs into the registry are not.
- **Per-character content packs.** Characters record `packs`, but the builder and sheet use the global pack toggle.
- **Phase 2** (designed in PROPOSAL.md, not built): campaigns, GM view, invites, Fear tracker, stat-block tools.

Smaller gaps, closed 2026-11-10:
- **Choices** (all curated in `content/srd/modifiers.json`, validated at parse time):
  - Vitality (two benefits, applied from the vault) and Master of the Craft (+2/+2 or +3); both go to the vault permanently and can't be recalled
  - Warlock patron name and sphere
  - Wizard Strange Patterns number (the roller flags a match)
  - Brawler's Strike trait
  - Elemental Origin element
  - made in the builder, the level-up wizard or the sheet
- **Resources** (Play tab):
  - Warlock Favor (3 → max 6)
  - Seraph Prayer Dice (roll d4 × Spellcast; tap a die to spend it; clears on a new session)
  - Guardian Unstoppable Die (d4/d6 counting up)
  - Rally, Patron and Combo die sizes
  - a **Used** checkbox on every "once per rest / long rest / session / scene" feature and card, cleared by rests and "Start a new session"
  - **token counters** on cards that use tokens
- **Brawler's Strike:** +1 Evasion and a Proficiency × (d8 + d6) attack while no weapons are active.
- **Beastform** (Druid):
  - transform within your tier by marking a Stress, or with Evolution (3 Hope, +1 to a trait)
  - the form's Evasion and trait bonuses apply; attack with the form; weapons are blocked
  - drop out manually or automatically on your last HP
- **Ranger companion** (Beastbound):
  - editor in the builder and on the sheet
  - Evasion 10, d6 Melee attack, Stress track, Experiences, command-to-attack roll
  - a companion option at each level-up (Aware, Resilient, Vicious die/range, Intelligent, Light in the Dark (+1 Hope slot), …)
  - a new companion Experience at levels 2/5/8
  - companion Stress clears when yours does on a rest
- **`srd-frames` equipment:** 76 weapons and 16 armor from Everyday Hero (Tier 1), Western and Monster Hunting. Tier-scaled items are one entry per tier ("Revolver (Tier 2)"), selectable once the frames pack is on.
- **Code splitting:** the main bundle went from ~600 KB to 257 KB (80 KB gzipped). Route chunks are prefetched after start-up so offline still covers every screen.
- **Tests:** 136 in total.

Still partial:
- **Legendary/Mythic Beast** (upgrade forms) can be chosen but don't apply their "+6 damage, +1 trait, +2 Evasion" upgrade automatically. Hybrid forms use their listed stats; their borrowed advantages/features are text only.
- Feature effects that depend on conditions (e.g. "while Channeling") stay as text.

Needs the owner:
- Discord OAuth app (keys in the Supabase dashboard). Google is done and tested by the owner.
- A browser pass of stages 4–8 (builder, level-up, sheet, dice, offline mode, print).
- Deploying (docs/SETUP.md §6).

Skipped by decision:
- Automated RLS tests (D9).
- Deferred from stage 1:
  - **Domain icons (D12).** In the PDF they are vector drawings with soft masks, not plain images, so extracting them means rendering and cropping page 7. Planned for stage 3 (compendium), where they're first shown.
  - **`srd-frames` equipment.** Everyday Hero / Western / Tech gear exists only as tables in the rules pages, not yet as selectable weapon/armor entries. Do this before the builder stage if frames are enabled for a character.
  - **Starting equipment** (SRD p. 5, step 5) is rules text only. The builder stage will need it as data.

## Decisions (2026-11-06)
- D1. Approved by the owner. Clarified 2026-11-06: DaggerPlayer is a private/internal tool. Under DPCGL §1.8, private non-commercial play within a gaming group isn't "Sharing". If it ever opens to the public, revisit docs/LICENSE-NOTES.md.
- D2. Bundle SRD 2.0.
- D3. The Witherwild Campaign Frame and supplemental mechanics ship as the `srd-frames` pack, off by default, with a per-character toggle.
- D4. Free, non-commercial. §4.1 attribution only. No ads, paywalls, or donations tied to access.
- D5. Name: DaggerPlayer.
- D6. Homebrew can be shown to other users. This replaces brief rule 5's "private to that user" for Phase 2 sharing. Phase 1 has no sharing UI.
- D7. Fix SRD typos. Each fix is logged in `content/srd/errata.json` and noted in the attribution modification statement.
- D8. Version snapshots: always on level-up, builder finish, import, and restore. Otherwise at most one per 10 minutes. Keep 20.
- D9. RLS tests: **skipped** by owner decision (2026-11-06). The brief's "test that one user can't read another's data" is not automated; policies are still written and reviewed.
- D10. A print stylesheet is enough for PDF export.
- D11. Use Supabase's built-in email for now. It's rate-limited; revisit before launch.
- General rule (2026-11-06): when any non-SRD source (character sheet, owner notes) conflicts with SRD 2.0, follow the SRD.
- D12. Extract domain icons from the SRD PDF (deferred to stage 3, see above).

## Open rules questions
1. ~~Advancement slots per tier~~ Resolved 2026-11-06: the owner supplied the counts. They're in `content/srd/supplied/advancement-slots.json` and appear in the data as `progression.advancements[].slotsByTier`. Where the sheet and the SRD disagree, **the SRD wins** (owner ruling, 2026-11-06). So:
   - Domain cards are "at or below your level" in every tier (the sheet's tier-3 "(up to level 4)" is ignored).
   - Multiclassing crosses out the upgraded-subclass option in the current tier only.
2. **Octopus, "Thresholds: 3/None" (p. 105).** Deferred to the Phase 2 GM tools.
4. ~~Unarmored thresholds with bonuses (p. 72)~~ Owner confirmed 2026-11-06: permanent threshold bonuses still apply when unarmored.
5. ~~Starting gear (p. 5)~~ Owner confirmed 2026-11-06: a secondary weapon is optional (warning only), and no weapon is allowed (Brawler).
6. ~~Recall Cost with partly marked Stress (pp. 8, 50)~~ Owner confirmed 2026-11-10: allow the recall; a shortfall marks 1 HP. Original question: Recalling a card costs Stress equal to its Recall Cost. SRD p. 50 says you can't use a move that requires marking Stress when *all* your Stress is marked, and if you must mark Stress but can't, you mark 1 HP instead. The app allows a recall when at least one Stress is free, and marks 1 HP for any shortfall. Example: Recall Cost 2 with 1 free Stress marks the last Stress plus 1 HP. Should it instead require enough free Stress for the full cost?
7. ~~Help an Ally against disadvantage (p. 49)~~ Owner confirmed 2026-11-10: each helper cancels a disadvantage. Original question: The SRD says advantage and disadvantage cancel one for one, and that Help an Ally adds extra advantage dice (highest counts). It doesn't say whether an ally's Help cancels a disadvantage. The app treats each helper as an advantage source for cancelling, e.g. disadvantage + one helper = no extra die. Correct?
8. ~~Companion starting Stress (p. 21)~~ Owner supplied 2026-11-10: **3 slots**, from the companion sheet (not in SRD 2.0). It's the default (`COMPANION_DEFAULT_STRESS`), and the player can change it.
9. **Companion level-up options (p. 22).** Owner unsure (2026-11-10). Kept as **once per option**, the stricter reading of "choose one available option … and mark it". It's easy to relax later. To settle it: if the companion sheet shows one checkbox per option, once each is right.
