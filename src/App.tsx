import { lazy, Suspense, useEffect, useState } from "react";
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { bundledPacks, loadEntries } from "./content/packs.ts";
import { useSettingsSync } from "./data/settings.ts";
import { supabaseConfigured } from "./data/supabase.ts";
import { SettingsPanel } from "./features/account/SettingsPanel.tsx";
import { ContentProvider } from "./content/ContentProvider.tsx";
import { useOnline } from "./data/outbox.ts";
import { AuthProvider, RequireAuth, useAuth } from "./features/auth/AuthProvider.tsx";
import { AuthCallbackPage, CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from "./features/auth/pages.tsx";
import { LegalPage, ShortAttribution } from "./features/legal/LegalPage.tsx";

// Route groups load on demand (smaller first download). After start-up they're prefetched so the
// service worker has every screen cached for offline play.
const compendium = () => import("./features/compendium/pages.tsx");
const builder = () => import("./features/builder/BuilderPage.tsx");
const characters = () => import("./features/characters/pages.tsx");
const sheet = () => import("./features/sheet/SheetPage.tsx");
const print = () => import("./features/sheet/PrintPage.tsx");
const history = () => import("./features/sync/HistoryPage.tsx");
const levelup = () => import("./features/levelup/LevelUpPage.tsx");
const account = () => import("./features/account/AccountPage.tsx");
export const ROUTE_CHUNKS = [compendium, builder, characters, sheet, print, history, levelup, account];

const CompendiumPage = lazy(() => compendium().then((m) => ({ default: m.CompendiumPage })));
const EntryPage = lazy(() => compendium().then((m) => ({ default: m.EntryPage })));
const RulesIndexPage = lazy(() => compendium().then((m) => ({ default: m.RulesIndexPage })));
const RulesPage = lazy(() => compendium().then((m) => ({ default: m.RulesPage })));
const BuilderPage = lazy(() => builder().then((m) => ({ default: m.BuilderPage })));
const NewCharacterPage = lazy(() => builder().then((m) => ({ default: m.NewCharacterPage })));
const CharactersPage = lazy(() => characters().then((m) => ({ default: m.CharactersPage })));
const SheetPage = lazy(() => sheet().then((m) => ({ default: m.SheetPage })));
const PrintPage = lazy(() => print().then((m) => ({ default: m.PrintPage })));
const HistoryPage = lazy(() => history().then((m) => ({ default: m.HistoryPage })));
const LevelUpPage = lazy(() => levelup().then((m) => ({ default: m.LevelUpPage })));
const AccountPage = lazy(() => account().then((m) => ({ default: m.AccountPage })));

function Layout() {
  const { user } = useAuth();
  useSettingsSync(user?.id ?? null);
  const online = useOnline();
  return (
    <>
      <a className="skip" href="#main">
        Skip to content
      </a>
      <header className="site-header">
        <Link to="/" className="brand">
          DaggerPlayer
        </Link>
        <nav aria-label="Main">
          <NavLink to="/characters">Characters</NavLink>
          <NavLink to="/compendium">Compendium</NavLink>
          <NavLink to="/rules">Rules</NavLink>
          {user ? <NavLink to="/account">Account</NavLink> : <><NavLink to="/settings">Settings</NavLink> <NavLink to="/auth/sign-in">Sign in</NavLink></>}
        </nav>
      </header>
      {!supabaseConfigured && (
        <p className="banner" role="status">
          Accounts are unavailable: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY aren't set (see docs/SETUP.md).
        </p>
      )}
      {!online && (
        <p className="banner" role="status">
          You're offline. Your characters and the rules still work; changes upload when you reconnect.
        </p>
      )}
      <main id="main" tabIndex={-1}>
        <Suspense fallback={<p role="status">Loading…</p>}>
          <Outlet />
        </Suspense>
      </main>
      <ScrollRestoration />
      <footer className="site-footer">
        <ShortAttribution />
      </footer>
    </>
  );
}

function HomePage() {
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
    <>
      <h1>DaggerPlayer</h1>
      <p>A Daggerheart™ Compatible character companion.</p>
      <p>
        <Link className="button primary" to="/build/new">Build a character</Link> <Link to="/characters">Your characters</Link> · <Link to="/compendium">Compendium</Link> · <Link to="/rules">Rules</Link>
      </p>
      <h2>Bundled content</h2>
      {bundledPacks.map((p) => (
        <section key={p.id}>
          <h3>
            {p.name} <small>({p.defaultEnabled ? "on" : "off"} by default)</small>
          </h3>
          <ul className="counts">
            {Object.entries(counts[p.id] ?? {}).map(([t, n]) => (
              <li key={t}>
                {t}: {n}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </>
  );
}

function NotFound() {
  return (
    <>
      <h1>Page not found</h1>
      <Link to="/">Go home</Link>
    </>
  );
}

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <HomePage /> },
      { path: "/auth/sign-in", element: <SignInPage /> },
      { path: "/auth/sign-up", element: <SignUpPage /> },
      { path: "/auth/check-email", element: <CheckEmailPage /> },
      { path: "/auth/forgot", element: <ForgotPasswordPage /> },
      { path: "/auth/reset", element: <ResetPasswordPage /> },
      { path: "/auth/callback", element: <AuthCallbackPage /> },
      { path: "/compendium", element: <CompendiumPage /> },
      { path: "/compendium/:pack/:type/:slug", element: <EntryPage /> },
      { path: "/rules", element: <RulesIndexPage /> },
      { path: "/rules/:pack/:slug", element: <RulesPage /> },
      { path: "/characters", element: <CharactersPage /> },
      { path: "/characters/:id", element: <SheetPage /> },
      { path: "/characters/:id/level-up", element: <LevelUpPage /> },
      { path: "/characters/:id/history", element: <HistoryPage /> },
      { path: "/characters/:id/print", element: <PrintPage /> },
      { path: "/build/new", element: <NewCharacterPage /> },
      { path: "/build/:id/:step", element: <BuilderPage /> },
      { path: "/account", element: <RequireAuth><AccountPage /></RequireAuth> },
      { path: "/legal", element: <LegalPage /> },
      { path: "/settings", element: <><h1>Settings</h1><SettingsPanel /></> },
      { path: "*", element: <NotFound /> },
    ],
  },
]);

export function App() {
  return (
    <AuthProvider>
      <ContentProvider>
        <RouterProvider router={router} />
      </ContentProvider>
    </AuthProvider>
  );
}
