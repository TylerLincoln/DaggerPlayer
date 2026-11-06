# Project: Daggerheart player companion (Demiplane-style)

## Goal
Build a web app that lets players create and run Daggerheart characters. It should work like the Daggerheart Nexus on Demiplane: a guided character builder, a live character sheet for use at the table, and a searchable rules compendium. Every rule, card, and item in the app links back to its source text. Users log in, and their characters and settings save to their account.

Do not copy Demiplane's name, logo, layout, colors, or text. Match the function, not the look. Give the app its own name and visual style.

## Content and licensing rules
These rules come first. If a feature conflicts with them, drop the feature and tell me.

1. The core content source is the Daggerheart SRD 1.0, released by Darrington Press under the Darrington Press Community Gaming License (DPCGL). Download the SRD from daggerheart.com/srd and read the DPCGL at darringtonpress.com/license before you start.
2. Only include text marked as Public Game Content. Do not include art, card art, trade dress, or text from the Core Rulebook, Class Packs, or other products unless Darrington Press has released it as Public Game Content.
3. Before adding anything beyond SRD 1.0, check daggerheart.com for newer SRD versions or new Public Game Content. List what you found and where, and wait for my OK before adding it.
4. Use the DPCGL community logo and attribution text the way the license requires. Do not use the official Daggerheart logo.
5. Build a homebrew importer so users can add their own content for their table. Homebrew saves to the user's account, gets a clear "Homebrew" tag, and is private to that user. It never ships in the app's bundled data and is never shown to other users.
6. Give every piece of content a source field (SRD 1.0 page, Public Game Content release, or Homebrew).

## Data layer
- Turn the SRD into structured JSON, one file or folder per type: classes, subclasses, domains, domain cards, ancestries, communities, weapons, armor, items, consumables, loot, adversaries, environments, rules sections, and glossary terms.
- Write a schema for each type (TypeScript types plus Zod or JSON Schema). Tag rules terms inside feature text so the UI can link them.
- Content packs: the bundled SRD pack, plus any number of homebrew packs. Packs can be turned on or off per character.
- Write a validation script that checks every pack against the schema and flags broken links between entries (for example, a subclass that points at a class that does not exist).
- Keep the raw SRD text next to the parsed JSON so I can spot parsing errors.

## Character builder
A step-by-step flow with a progress bar. The player can jump back to any step.
1. Class and subclass (show domains, starting HP, Evasion, class feature, Hope feature)
2. Heritage: ancestry (including mixed ancestry per the SRD) and community
3. Traits: assign +2, +1, +1, +0, +0, -1 across Agility, Strength, Finesse, Instinct, Presence, and Knowledge. Support drag-and-drop and tap-to-assign.
4. Starting gear: weapons, armor, starting items, gold
5. Background questions and Experiences
6. Level 1 domain cards
7. Connections
8. Review screen that lists every choice and anything still missing

Each option shows its full SRD text in a side drawer before the player picks it. Show what each choice changes on the sheet (for example, "+1 Evasion").

Leveling: a level-up wizard that walks through tier achievements and advancement choices per the SRD. It blocks choices the rules don't allow.

## Character sheet (the main play screen)
Built for use at the table on a phone, tablet, or laptop.
- Core stats: traits, Evasion, Armor score and slots, Major and Severe damage thresholds, HP, Stress, Hope, Proficiency, level
- Tap-to-mark trackers for HP, Stress, Armor slots, and Hope
- Damage input: enter a number, compare it to thresholds, and mark the right HP. Offer to spend an Armor slot first.
- Duality dice roller: roll the Hope d12 and Fear d12, add the trait and modifiers, and add advantage or disadvantage d6. Show "with Hope" or "with Fear," apply the SRD results (like gaining Hope), and flag critical successes on matching dice.
- Tap any trait, weapon, or Experience to roll with it
- Domain card loadout (5 active max) and vault, with swap rules shown
- Inventory, gold (handfuls, bags, chests), and consumables with counters
- Short and long rest moves with counters
- Conditions and temporary effects with on/off toggles
- Tabs for notes, background, and Connections
- A roll history log for the session
- Every rules term on the sheet is a link. Hover or tap shows a tooltip. Click opens the full entry in the compendium.

## Compendium
- Full-text search across enabled packs, with filters for type, tier, domain, class, and source
- Each entry gets its own URL for sharing and bookmarks
- Cross-links between entries (a domain card links to its domain, which links to its classes)
- Rules sections laid out as readable pages with a table of contents

## Accounts and saved data
- User login is required to save characters. Visitors without an account can browse the compendium and try the builder, then sign up to save.
- Sign-in options: email and password, magic link, and Google or Discord login.
- Include sign up, sign in, sign out, password reset, and email verification.
- Each user's data is private. Use row-level security (or the equivalent) so users can only read and write their own records. Test this.
- Data saved per user: characters (all builder choices, sheet state, trackers, inventory, notes, roll history), homebrew packs, which packs are turned on, and settings (theme, dice options).
- Save sheet changes as they happen, with a "saved" indicator. Don't lose data if the user closes the tab mid-session.
- Keep a local cache so the sheet still works offline at the table. Sync when the connection comes back. If the same character changed on two devices, show both versions and let the user pick.
- Keep version history for each character (at least the last 20 saves) so a user can roll back a bad level-up or a mistake.
- Account page: change email, change password, export all my data as JSON, and delete my account and all its data.
- Export and import single characters as JSON.
- Export a sheet as a printable PDF.
- The SRD content pack stays static and bundled with the app. Only user data lives in the database.
- Phase 2 (plan the database for it, don't build it yet): campaigns, a GM view of party sheets, invite links, a GM Fear tracker, and adversary and environment stat blocks.

## Tech stack
Use React, TypeScript, and Vite for the front end. Use Supabase for auth and the Postgres database unless you see a clear reason to pick something else. If you do, tell me why in one or two sentences.
- Phase 1 must run on free tiers.
- Keep dependencies small.
- Never store passwords yourself. Use the auth provider.
- Keep secrets in environment variables, never in the repo.
- Write database migrations so I can rebuild the schema from scratch.
- Include a short setup guide: how to create the Supabase project, set the environment variables, run locally, and deploy (Vercel, Netlify, or Cloudflare Pages).

## Accessibility and design
- WCAG 2.1 AA contrast, keyboard navigation, and screen reader labels on trackers and dice
- Light and dark mode
- Mobile-first layout for the sheet. The builder can use more space on desktop.

## How to work
1. Read the SRD and the DPCGL first. Write a short summary of what the license allows for a web app with user accounts, including any limits on formats, and flag anything I need to decide.
2. Propose the data schema, database schema, and app structure. Wait for my approval.
3. Build in this order: data layer and validator, auth and database schema, compendium, builder, sheet, dice and trackers, sync and offline cache, PDF export.
4. After each stage, give me a working build and a short list of what's done, what's left, and any rules you weren't sure how to read.
5. When the SRD is unclear, don't guess. Note the rule, cite the page, and ask me.
6. Write tests for the rules logic: trait math, thresholds, damage marking, Hope and Fear results, loadout limits, and level-up limits. Also test that one user can't read or change another user's data.
