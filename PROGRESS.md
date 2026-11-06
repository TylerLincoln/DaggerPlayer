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
  - **Still needs the owner:** Google and Discord OAuth apps (keys go in the dashboard). Until then those two buttons return an error.
- Stage 3: compendium (and domain icons, D12).
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
- D12. Extract domain icons from the SRD PDF (deferred to stage 3, see above).

## Open rules questions
1. ~~Advancement slots per tier~~ Resolved 2026-11-06: the owner supplied the counts. They're in `content/srd/supplied/advancement-slots.json` and appear in the data as `progression.advancements[].slotsByTier`. Two differences between the sheet and the SRD text need a ruling before the level-up wizard (stage 4/5):
   - **Domain card limit.** The sheet's domain-card option reads "(up to level 4)" in tier 3 as well as tier 2. SRD p. 54 says "at or below your level". The tier-3 note looks like a copy error on the sheet. Plan: follow the SRD unless told otherwise.
   - **Multiclass cross-out.** The sheet says multiclassing crosses out "an unused 'Take an upgraded subclass card'" (any tier). SRD p. 54 says "cross out the 'upgraded subclass' advancement option in this tier". Plan: follow the SRD unless told otherwise.
2. **Octopus, "Thresholds: 3/None" (p. 105).** Deferred to the Phase 2 GM tools.
3. ~~Witherwild license conflict~~ Resolved: include it. The owner describes DaggerPlayer as a private/internal tool (2026-11-06), so the frames pack ships with a per-character toggle (D3).
