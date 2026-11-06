import { useEffect, useState } from "react";
import { createBrowserRouter, Link, NavLink, Outlet, RouterProvider, ScrollRestoration } from "react-router";
import { bundledPacks, loadEntries } from "./content/packs.ts";
import { supabaseConfigured } from "./data/supabase.ts";
import { ContentProvider } from "./content/ContentProvider.tsx";
import { AccountPage } from "./features/account/AccountPage.tsx";
import { CompendiumPage, EntryPage, RulesIndexPage, RulesPage } from "./features/compendium/pages.tsx";
import { AuthProvider, RequireAuth, useAuth } from "./features/auth/AuthProvider.tsx";
import { AuthCallbackPage, CheckEmailPage, ForgotPasswordPage, ResetPasswordPage, SignInPage, SignUpPage } from "./features/auth/pages.tsx";
import { LegalPage, ShortAttribution } from "./features/legal/LegalPage.tsx";

function Layout() {
  const { user } = useAuth();
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
          <NavLink to="/compendium">Compendium</NavLink>
          <NavLink to="/rules">Rules</NavLink>
          {user ? <NavLink to="/account">Account</NavLink> : <NavLink to="/auth/sign-in">Sign in</NavLink>}
        </nav>
      </header>
      {!supabaseConfigured && (
        <p className="banner" role="status">
          Accounts are unavailable: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY aren't set (see docs/SETUP.md).
        </p>
      )}
      <main id="main" tabIndex={-1}>
        <Outlet />
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
      <p>A Daggerheart™ Compatible character companion. The builder and sheet arrive in the next stages.</p>
      <p>
        <Link to="/compendium">Search the compendium</Link> · <Link to="/rules">Read the rules</Link>
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
      { path: "/account", element: <RequireAuth><AccountPage /></RequireAuth> },
      { path: "/legal", element: <LegalPage /> },
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
