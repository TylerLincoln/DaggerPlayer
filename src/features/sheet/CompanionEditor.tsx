import type { CharacterDoc } from "../../rules/character.ts";

type Companion = NonNullable<CharacterDoc["state"]["companion"]>;

export const emptyCompanion = (): Companion => ({
  name: "",
  kind: "",
  experiences: [{ id: crypto.randomUUID(), name: "", bonus: 2 }, { id: crypto.randomUUID(), name: "", bonus: 2 }],
  attack: "",
  damageType: "phy",
  baseStress: 3, // companion sheet default (owner-supplied; not in SRD 2.0)
  stressMarked: 0,
});

/** Beastbound Ranger companion details (SRD p. 21). */
export function CompanionEditor({ value, onChange }: { value: Companion | null; onChange: (c: Companion) => void }) {
  const k = value ?? emptyCompanion();
  const set = (patch: Partial<Companion>) => onChange({ ...k, ...patch });
  return (
    <fieldset className="companion-editor">
      <legend>Your companion</legend>
      <p className="hint">Evasion starts at 10; attacks deal d6 damage at Melee range using your Proficiency (SRD p. 21).</p>
      <div className="field"><label htmlFor="comp-name">Name</label><input id="comp-name" value={k.name} maxLength={80} onChange={(e) => set({ name: e.target.value })} /></div>
      <div className="field"><label htmlFor="comp-kind">What kind of animal</label><input id="comp-kind" value={k.kind} maxLength={120} onChange={(e) => set({ kind: e.target.value })} /></div>
      {k.experiences.map((x, i) => (
        <div className="field" key={x.id}>
          <label htmlFor={`comp-xp-${i}`}>Companion Experience {i + 1} (+{x.bonus})</label>
          <input id={`comp-xp-${i}`} value={x.name} maxLength={80} list="comp-xp-examples" onChange={(e) => set({ experiences: k.experiences.map((y, j) => (j === i ? { ...y, name: e.target.value } : y)) })} />
        </div>
      ))}
      <datalist id="comp-xp-examples">{["Bold Distraction", "Expert Climber", "Fetch", "Loyal Until the End", "Navigation", "On High Alert", "Protective", "Scout", "Vigilant", "We Always Find Them"].map((x) => <option key={x} value={x} />)}</datalist>
      <div className="field"><label htmlFor="comp-attack">Standard attack (how they deal damage)</label><input id="comp-attack" value={k.attack} maxLength={200} onChange={(e) => set({ attack: e.target.value })} /></div>
      <fieldset>
        <legend>Damage type</legend>
        <label className="radio"><input type="radio" name="comp-dmg" checked={k.damageType === "phy"} onChange={() => set({ damageType: "phy" })} /> Physical</label>
        <label className="radio"><input type="radio" name="comp-dmg" checked={k.damageType === "mag"} onChange={() => set({ damageType: "mag" })} /> Magic</label>
      </fieldset>
      <div className="field">
        <label htmlFor="comp-stress">Starting Stress slots (from the companion sheet)</label>
        <input id="comp-stress" inputMode="numeric" value={k.baseStress ?? ""} onChange={(e) => set({ baseStress: e.target.value === "" ? null : Math.min(12, Number(e.target.value.replace(/\D/g, ""))) })} />
        <small className="hint">Default 3, from the companion sheet (SRD 2.0 doesn't list it). Leave empty to use the default.</small>
      </div>
    </fieldset>
  );
}
