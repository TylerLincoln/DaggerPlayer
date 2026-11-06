# Progress

## Done
- Step 1: read the brief, DPCGL 2.0, and SRD 2.0 (Aug 25, 2026). Notes are in docs/LICENSE-NOTES.md.
- Step 2: proposal in docs/PROPOSAL.md, approved 2026-11-06.

## Next
- Stage 1: data layer and validator (in progress).

## Decisions (2026-11-06)
- D1. Public web app: approved by the owner. Keep any written approval from DRP on file.
- D2. Bundle SRD 2.0.
- D3. The Witherwild Campaign Frame and supplemental campaign mechanics ship as a separate pack (`srd-frames`), off by default, with a per-character toggle.
- D4. Free, non-commercial. §4.1 attribution only. No ads, paywalls, or donations tied to access.
- D5. Name: DaggerPlayer.
- D6. Homebrew can be shown to other users. This replaces brief rule 5's "private to that user" for Phase 2 sharing. Phase 1 still has no sharing UI.
- D7. Fix SRD typos. Log every fix in `content/srd/errata.json` and say so in the attribution modification statement.
- D8. Version snapshots: always on level-up, builder finish, import, and restore. Otherwise at most one per 10 minutes. Keep the last 20.
- D9. RLS test environment: **on hold**. Needed before stage 2 is done.
- D10. A print stylesheet is enough for PDF export.
- D11. Use Supabase's built-in email for now. It's rate-limited; revisit before launch.
- D12. Extract domain icons from the SRD PDF.

## Open rules questions
- (none yet)
