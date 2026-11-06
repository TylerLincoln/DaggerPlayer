import { type InputHTMLAttributes, useId } from "react";

export function Field({ label, hint, ...input }: { label: string; hint?: string } & InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-describedby={hintId} {...input} />
      {hint && (
        <small id={hintId} className="hint">
          {hint}
        </small>
      )}
    </div>
  );
}

/** Announced to screen readers when it appears. */
export function FormMessage({ error, info }: { error?: string | null; info?: string | null }) {
  if (error)
    return (
      <p className="msg msg-error" role="alert">
        {error}
      </p>
    );
  if (info)
    return (
      <p className="msg msg-info" role="status">
        {info}
      </p>
    );
  return null;
}

export const errorText = (e: unknown) => (e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e));
