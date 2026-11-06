# Importing an existing character

DaggerPlayer imports one character per JSON file: **Characters → Import JSON**. The file has to match `character.schema.json`. `character-template.json` is a complete, valid example: a level 2 Ranger.

Files here (regenerate with `npm run import-kit`):

| File | What it is |
|---|---|
| `character-template.json` | Example character to copy the shape from |
| `character.schema.json` | JSON Schema the importer checks |
| `ids.md` | Every valid id: classes, subclasses, ancestries, communities, cards, weapons, armor, items, and the level-up option ids |

After importing, open the character and use **Edit build → Review**. It lists anything the rules don't accept.

## Prompt for Claude

Attach `character-template.json`, `character.schema.json`, `ids.md` and your sheet (photo or PDF), then paste:

> Convert my Daggerheart character sheet into a DaggerPlayer character JSON file.
>
> - **Shape and ids.** Match `character.schema.json` exactly, using `character-template.json` as the model. Use only ids listed in `ids.md` for classes, subclasses, ancestries, communities, transformations, domain cards, weapons, armor and consumables. Anything that isn't in `ids.md` (homebrew or custom items) goes in plain text: inventory item names, `build.gear.extraItems`, `build.classNotes` or `notes`.
> - **Choices, not totals.** The app stores choices and recomputes Evasion, max HP, max Stress, Armor Score, damage thresholds, Proficiency and trait totals. Don't try to store those numbers. Instead, record choices that reproduce them:
>   - `build.traits` holds only the **starting** spread: +2, +1, +1, +0, +0 and −1, once each. Trait increases from leveling go in `levelUps[].advancements` (`optionId: "traits"`, two trait names).
>   - `build.experiences` holds only the **two starting** Experiences at +2. Experiences gained at levels 2, 5 and 8 go in that level-up's `newExperience` (+2). +1 increases go in an `"experiences"` advancement with two experience ids.
>   - A level N character needs exactly N−1 entries in `levelUps`, for levels 2…N in order. Each entry has:
>     - two advancements; a `cost` 2 option (`proficiency`, `multiclass`) counts as both
>     - a `domainCardId` for the card every level grants
>     - a `newExperience` at levels 2, 5 and 8
>     - `exchange: null` unless a card was swapped
>   - Advancement option ids, extra fields and slots per tier are at the end of `ids.md`. Respect the slot counts.
> - **Missing history.** If my sheet doesn't show which advancements I took at which level, reconstruct a plausible history that reproduces my current HP slots, Stress slots, Evasion, Proficiency, trait totals and Experience bonuses. Remember the starting values come from the class and from ancestry/subclass features. **List every guess you made** after the JSON.
> - **Cards.** `build.domainCardIds` is the two level-1 cards chosen at creation. Every card I hold must be either a starting card or a level-up card. `state.loadout` holds up to 5 active cards; the rest go in `state.vault`.
> - **Current state.** `state` holds the current table state:
>   - marked HP, Stress and Armor Slots
>   - current Hope
>   - equipped weapons and armor (`activePrimaryId`, `activeSecondaryId`, `armorId`)
>   - inventory (each item needs a unique `id` string and `qty`)
>   - gold (handfuls 0–9, bags 0–9, chests 0–1)
> - **Fixed fields.**
>   - Set `finishedAt` to any ISO date.
>   - Set `schemaVersion` to 1.
>   - `packs` is `["srd"]`. Add `"srd-frames"` only if I use Witherwild or supplemental content.
>   - `id` must be a UUID. The app replaces it on import.
> - **Output.** Output the JSON in one code block, then the list of guesses and anything you couldn't place.

## Things to know

- **IDs:** imported characters always get a new id, so importing never overwrites an existing character.
- **What the importer checks:** only the file's shape. Rules problems (wrong card levels, too many advancements in a tier) show up on the Review page and the level-up wizard, so check those after importing.
- **Saving:** if you're signed in, the imported character is saved to your account like any other.
