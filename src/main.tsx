import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { bundledPacks, loadEntries } from "./content/packs.ts";

// Stage 1 placeholder: shows that the bundled content packs load. The real app starts in stage 3.
function PackSummary() {
  const [counts, setCounts] = useState<Record<string, Record<string, number>>>({});
  useEffect(() => {
    Promise.all(
      bundledPacks.map(async (p) => {
        const c: Record<string, number> = {};
        for (const e of await loadEntries([p.id])) c[e.type] = (c[e.type] ?? 0) + 1;
        return [p.id, c] as const;
      }),
    ).then((r) => setCounts(Object.fromEntries(r)));
  }, []);
  return (
    <main style={{ fontFamily: "system-ui, sans-serif", maxWidth: 640, margin: "2rem auto", padding: "0 16px" }}>
      <h1>DaggerPlayer</h1>
      <p>Stage 1 (data layer). Bundled content packs:</p>
      {bundledPacks.map((p) => (
        <section key={p.id}>
          <h2>
            {p.name} <small>({p.id}, {p.defaultEnabled ? "on" : "off"} by default)</small>
          </h2>
          <ul>
            {Object.entries(counts[p.id] ?? {}).map(([t, n]) => (
              <li key={t}>
                {t}: {n}
              </li>
            ))}
          </ul>
        </section>
      ))}
      <footer>
        <p><small>{bundledPacks[0]?.attribution}</small></p>
      </footer>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <PackSummary />
  </StrictMode>,
);
