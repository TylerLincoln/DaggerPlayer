import type { Feature } from "../../content/schema/index.ts";

type Choice = NonNullable<Feature["choices"]>[number];

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * One input for any feature/card choice. The value is a string: an option, comma-separated options,
 * free text, an Experience id, or for Master of the Craft "two:<id>,<id>" / "one:<id>".
 */
export function ChoiceInput({ choice, value = "", onChange, experiences, label }: {
  choice: Choice;
  value?: string;
  onChange: (v: string) => void;
  experiences: { id: string; name: string }[];
  label: string;
}) {
  const id = `choice-${choice.id}`;
  const o = choice.options;
  const picked = value.split(",").filter(Boolean);
  const toggle = (opt: string) => {
    const has = picked.includes(opt);
    const next = has ? picked.filter((p) => p !== opt) : [...picked, opt].slice(-choice.count);
    onChange(next.join(","));
  };

  if (o === "free-text")
    return (
      <div className="field">
        <label htmlFor={id}>{label}: {choice.prompt}</label>
        <input id={id} value={value} maxLength={120} onChange={(e) => onChange(e.target.value)} />
      </div>
    );

  if (Array.isArray(o) && o.every((x) => typeof x === "string")) {
    const opts = o as string[];
    if (choice.count === 1)
      return (
        <div className="field">
          <label htmlFor={id}>{label}: {choice.prompt}</label>
          <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
            <option value="">Choose…</option>
            {opts.map((x) => <option key={x} value={x}>{cap(x)}</option>)}
          </select>
        </div>
      );
    return (
      <fieldset>
        <legend>{label}: {choice.prompt}</legend>
        {opts.map((x) => <label key={x} className="radio"><input type="checkbox" checked={picked.includes(x)} onChange={() => toggle(x)} /> {cap(x)}</label>)}
      </fieldset>
    );
  }

  if (Array.isArray(o))
    return (
      <fieldset>
        <legend>{label}: {choice.prompt} ({picked.length} of {choice.count})</legend>
        {(o as { id: string; label: string }[]).map((x) => (
          <label key={x.id} className="radio">
            <input type="checkbox" checked={picked.includes(x.id)} onChange={() => toggle(x.id)} /> {x.label}
          </label>
        ))}
      </fieldset>
    );

  if (o.type === "experience")
    return (
      <fieldset>
        <legend>{label}: {choice.prompt}</legend>
        {experiences.map((x) => (
          <label key={x.id} className="radio">
            <input type="radio" name={id} checked={value === x.id} disabled={!x.name.trim()} onChange={() => onChange(x.id)} /> {x.name || "(unnamed Experience)"}
          </label>
        ))}
      </fieldset>
    );

  if (o.type === "experience-bonus") {
    const [mode = "two", ids = ""] = value.split(":");
    const sel = ids.split(",").filter(Boolean);
    const need = mode === "one" ? 1 : 2;
    const set = (m: string, s: string[]) => onChange(`${m}:${s.slice(-(m === "one" ? 1 : 2)).join(",")}`);
    return (
      <fieldset>
        <legend>{label}: {choice.prompt}</legend>
        <label className="radio"><input type="radio" name={`${id}-mode`} checked={mode === "two"} onChange={() => set("two", sel)} /> +2 to two Experiences</label>
        <label className="radio"><input type="radio" name={`${id}-mode`} checked={mode === "one"} onChange={() => set("one", sel)} /> +3 to one Experience</label>
        {experiences.map((x) => (
          <label key={x.id} className="radio">
            <input type="checkbox" checked={sel.includes(x.id)} onChange={() => set(mode, sel.includes(x.id) ? sel.filter((y) => y !== x.id) : [...sel, x.id])} /> {x.name}
          </label>
        ))}
        <p className="hint">{sel.length} of {need} chosen.</p>
      </fieldset>
    );
  }
  return null;
}
