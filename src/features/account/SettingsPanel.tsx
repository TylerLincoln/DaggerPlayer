import { updateSettings, useSettings } from "../../data/settings.ts";

/** Theme and dice options. Saved on this device, and to the account when signed in. */
export function SettingsPanel() {
  const s = useSettings();
  return (
    <section aria-labelledby="settings-h">
      <h2 id="settings-h">Settings</h2>
      <fieldset>
        <legend>Theme</legend>
        {(["system", "light", "dark"] as const).map((t) => (
          <label key={t} className="radio">
            <input type="radio" name="theme" checked={s.theme === t} onChange={() => updateSettings({ theme: t })} /> {t === "system" ? "Match my device" : t === "light" ? "Light" : "Dark"}
          </label>
        ))}
      </fieldset>
      <fieldset>
        <legend>Dice</legend>
        <label className="radio">
          <input type="checkbox" checked={s.dice.autoApply} onChange={(e) => updateSettings({ dice: { autoApply: e.target.checked } })} /> Apply roll results automatically (gain Hope; clear a Stress on a critical)
        </label>
        <label className="radio">
          <input type="checkbox" checked={s.dice.massiveDamage} onChange={(e) => updateSettings({ dice: { massiveDamage: e.target.checked } })} /> Use the optional Massive Damage rule (twice your Severe threshold marks 4 HP)
        </label>
      </fieldset>
    </section>
  );
}
