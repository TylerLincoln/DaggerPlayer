import { type ReactNode, useEffect, useRef } from "react";

/** Overflow menu built on <details>: keyboard-accessible without extra ARIA, closes on outside click, Escape, or choosing an item. */
export function MoreMenu({ label = "More", children }: { label?: string; children: ReactNode }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const close = (e: Event) => {
      const el = ref.current;
      if (!el?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== "Escape") return;
        el.open = false;
        el.querySelector("summary")?.focus();
      } else if (!el.contains(e.target as Node)) el.open = false;
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="more-menu" ref={ref}>
      <summary className="button">{label}</summary>
      <div className="more-menu-list" onClick={(e) => (e.target as HTMLElement).closest("a,button") && ref.current && (ref.current.open = false)}>
        {children}
      </div>
    </details>
  );
}
