# License notes (step 1)

Checked 2026-11-06 against:
- DPCGL 2.0: https://darringtonpress.com/wp-content/uploads/2026/08/DPCGL_2.0_AUG_26_2026.pdf (header says "Last Updated 8/05/2026"; the license page changelog says Aug 25, 2026)
- License page and FAQ: https://darringtonpress.com/license/
- SRD page: https://www.daggerheart.com/srd/ (only SRD 2.0 is offered for download: `DH_SRD_2_2026_08_25.pdf`, 224 pages)

This is my reading as a developer, not legal advice.

## What newer content exists (brief rule 3)
| Found | Where | Notes |
|---|---|---|
| Daggerheart SRD 2.0 (Aug 25, 2026) | daggerheart.com/srd | Named as Public Game Content in DPCGL 2.0 §1.6. Adds Assassin, Brawler, Warlock, Witch, Dread domain, Transformations, extra ancestries (Aetheris, Earthkin, Emberkin, Gnome, Skykin, Tidekin), supplemental campaign mechanics, rewritten advantage/spotlight/action-roll rules. |
| Domain icons | DPCGL §1.6 | Public Game Content, part of SRD 2.0. They are the only images we may use. |
| SRD 1.0 | DPCGL §1.6 | "remains Public Game Content for existing and legacy DRP Games". There's no longer a download link for it. The "SRD 1.0" link on the license page goes to the SRD page, which only offers 2.0. |
| DPCGL Community Content logos | darringtonpress.com/license (zip) | Required on commercial work. For Daggerheart, use the "alchemy bottle" version. |

Nothing has been added to the app yet. The raw text of SRD 2.0 was extracted into `content/srd-2.0/raw/` for review only.

## What the license allows

**Two kinds of grant (§2.1).**
- (a) Reproduce and Share Public Game Content "in whole or in part". This clause has no format limit.
- (b) Make, Share and sell **Adaptive Content**: anything derived from Public Game Content, or the content "translated, altered, rearranged, transformed". (b) applies only in **Permitted Formats**.

**Permitted Formats (§1.9):**
- print and digital print (supplements, manuals, books, stories, novels, cards)
- streaming and video
- podcasts
- **whitelisted VTTs only**: Roll20, Demiplane, Foundry, Alchemy, Fantasy Grounds

Video games and "any other audiovisual medium not expressly permitted" are excluded. Websites and apps are not listed.

**Whitelisted VTTs (§1.9.1):** non-commercial only. No selling access, no subscriptions, no paywalls, no donations tied to access. Other VTTs need DRP's written approval.

**Private play (§1.8):** private, non-commercial use "among friends, family, or gaming groups" is not Sharing, so the license terms don't apply to it.

**Prohibited Content (§1.5):**
- trademarks, logos, trade dress
- all art, maps, and imagery (except the domain icons)
- the exact text of rulebooks, manuals, and **Campaign Frames**, unless DRP has marked it as Public Game Content

**Campaign Frames (§1.9.3):** may only be Shared through actual-play streams and podcasts. SRD 2.0 includes the Witherwild Campaign Frame (pp. 184–189). Page 1 of the SRD says the whole document "including the Witherwild Campaign Frame" is Public Game Content. These two statements conflict.

**Name Marks (§2.5).** The marks are DAGGERHEART, DAGGERHEART: HOPE & FEAR, CANDELA OBSCURA, and ILLUMINATED WORLDS.
- They can't appear in the app's title or on the "front cover".
- In descriptive text they need "Compatible" next to them, e.g. "Daggerheart™ Compatible".
- No implied endorsement (§2.3, §6.4).

**No downstream restrictions (§2.2, §4.4).** Our terms can't restrict anyone's use of the SRD content we show or export.

**Attribution, non-commercial (§4.1).** Required wherever the content is Shared:
- the copyright notice
- the attribution text
- a link to the SRD
- a link to the license
- a statement of whether the content was modified

The license gives this combined text (SRD 2.0 version):

> This product includes materials from the Daggerheart System Reference Document 2.0, © Critical Role, LLC. under the terms of the Darrington Press Community Gaming (DPCGL) License. More information can be found at https://www.daggerheart.com. There are no previous modifications by others.

We restructure the SRD into data, so we must add a modification statement of our own, e.g. "Reformatted into structured data by [app name]; text otherwise unchanged except where noted."

**Attribution, commercial (§4.2), i.e. anything "in exchange for compensation":**
- the Community Content logo on the "front cover" (for us, the landing page and app shell)
- the statement "Darrington Press™ and the Darrington Press authorized work logo are trademarks of Critical Role, LLC and used with permission."

**Other terms:**
- DRP can amend the license at any time (§11). Work already in distribution can keep the old terms (§11.3).
- You must be 18+ (§6.1).
- No bigoted, obscene, or harassing use, as judged by DRP (§6.5).

## Limits on formats, as they apply to this app
1. A public web app with a builder, sheet, and compendium is not clearly a Permitted Format. The structured JSON, tooltips, and computed sheet are Adaptive Content, so they fall under §2.1(b). Demiplane being on the VTT whitelist suggests DRP treats tools like this as needing approval.
2. A **printable PDF sheet** fits "digital print" better. It still needs the attribution text.
3. A compendium that shows SRD text verbatim fits §2.1(a), which has no format limit. That clause is our strongest footing.
4. Keeping the app **private to your own table** avoids the question entirely (§1.8).

## Recommended handling
- Bundle only SRD 2.0 text, minus the Witherwild Campaign Frame, until you decide otherwise.
- No art except domain icons, and only if extracted from the SRD PDF itself. Our own visual style. No Daggerheart logo.
- Attribution text plus the modification statement in the app footer, on a `/legal` page, in every PDF export, and in JSON exports.
- "Daggerheart™ Compatible" only in descriptive text.
- Homebrew stays private per user. Our terms of use say users may only import content they have the right to use. The app never shows homebrew to other users.
