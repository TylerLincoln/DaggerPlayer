import type { Registry } from "../../content/registry.ts";
import type { CharacterDoc } from "../../rules/character.ts";
import { ACHIEVEMENT_LEVELS, type Derived } from "../../rules/derive.ts";
import { COMPANION_OPTIONS } from "../../rules/levelup.ts";
import { Inline } from "../../ui/RichText.tsx";

/**
 * Companion level-up choice for one level (SRD p. 22): one option per level, each option once
 * (other levels' picks are disabled), with the Vicious/Intelligent details and, at levels 2/5/8,
 * the companion's new +2 Experience.
 */
export function CompanionOptionPicker({ c, d, reg, level, option, experienceName, onOption, onExperience, idPrefix }: {
  c: CharacterDoc;
  d: Derived;
  reg: Registry;
  level: number;
  option: string | undefined;
  experienceName: string;
  onOption: (v: string) => void;
  onExperience: (name: string) => void;
  idPrefix: string;
}) {
  const prog = reg.get("srd/progression/leveling", "progression");
  const taken = c.levelUps.filter((x) => x.level !== level).map((x) => x.companionOption?.split(":")[0]);
  const cur = option ?? "";
  const base = cur.split(":")[0];
  // Experiences the companion had before this level (for Intelligent)
  const xps = [...(c.state.companion?.experiences ?? []), ...c.levelUps.filter((x) => x.level < level).flatMap((x) => (x.companionExperience ? [x.companionExperience] : []))];
  return (
    <div className="companion-picker">
      <fieldset>
        <legend>Companion option for level {level}</legend>
        {COMPANION_OPTIONS.map((id, i) => {
          const f = prog?.companionOptions[i];
          const usedElsewhere = taken.includes(id);
          return (
            <label key={id} className="radio">
              <input type="radio" name={`${idPrefix}-opt`} checked={base === id} disabled={usedElsewhere} onChange={() => onOption(id === "vicious" ? "vicious:die" : id)} />
              <span>
                <strong>{f?.name ?? id}</strong>
                {f && <>: <Inline text={f.text} links={false} /></>}
                {usedElsewhere && <small> (taken at another level)</small>}
              </span>
            </label>
          );
        })}
      </fieldset>
      {base === "vicious" && (
        <fieldset>
          <legend>Vicious: increase</legend>
          <label className="radio"><input type="radio" name={`${idPrefix}-vicious`} checked={cur === "vicious:die"} onChange={() => onOption("vicious:die")} /> Damage die (one step, e.g. d6 → d8)</label>
          <label className="radio"><input type="radio" name={`${idPrefix}-vicious`} checked={cur === "vicious:range"} onChange={() => onOption("vicious:range")} /> Range (one step, e.g. Melee → Very Close)</label>
        </fieldset>
      )}
      {base === "intelligent" && (
        <fieldset>
          <legend>Intelligent: +1 to a Companion Experience</legend>
          {xps.map((x) => (
            <label key={x.id} className="radio"><input type="radio" name={`${idPrefix}-intel`} checked={cur === `intelligent:${x.id}`} onChange={() => onOption(`intelligent:${x.id}`)} /> {x.name || "(unnamed)"}</label>
          ))}
        </fieldset>
      )}
      {ACHIEVEMENT_LEVELS.includes(level) && (
        <div className="field">
          <label htmlFor={`${idPrefix}-xp`}>{d.companion?.name || "Your companion"}'s new Experience at level {level} (+2)</label>
          <input id={`${idPrefix}-xp`} value={experienceName} maxLength={80} onChange={(e) => onExperience(e.target.value)} />
        </div>
      )}
    </div>
  );
}
