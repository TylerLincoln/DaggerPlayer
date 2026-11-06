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
  - **Still needs the owner:** Google and Discord OAuth apps (keys go in the dashboard). Until then those two buttons return an error.
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
- Next: stage 6, dice and trackers.
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
6. **Recall Cost with partly marked Stress (pp. 8, 50).** Recalling a card costs Stress equal to its Recall Cost. SRD p. 50 says you can't use a move that requires marking Stress when *all* your Stress is marked, and if you must mark Stress but can't, you mark 1 HP instead. The app allows a recall when at least one Stress is free, and marks 1 HP for any shortfall. Example: Recall Cost 2 with 1 free Stress marks the last Stress plus 1 HP. Should it instead require enough free Stress for the full cost?
