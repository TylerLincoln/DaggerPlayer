import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App, ROUTE_CHUNKS } from "./App.tsx";
import "./ui/theme.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// offline support (production builds only; the dev server is always online)
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
    // warm every route chunk so the whole app works offline after one visit
    const idle = (fn: () => void) => ("requestIdleCallback" in window ? requestIdleCallback(fn) : setTimeout(fn, 2000));
    idle(() => ROUTE_CHUNKS.forEach((load) => load().catch(() => {})));
  });
}
