# Setup

DaggerPlayer is a static React app plus a Supabase project (auth + Postgres). Everything runs on free tiers.

## 1. Create the Supabase project

1. Create a project at [supabase.com](https://supabase.com). Note its **project ref**: the `xxxx` in `https://xxxx.supabase.co`.
2. In **Project Settings → API**, copy the **Project URL** and the **anon public** key.

## 2. Environment variables

Never commit these. In Codespaces, add them as Codespaces secrets. Locally, put them in `.env.local` (git-ignored).

| Variable | Used by | Where to find it |
|---|---|---|
| `VITE_SUPABASE_URL` | app | Project Settings → API |
| `VITE_SUPABASE_ANON_KEY` | app | Project Settings → API (anon public key; safe in the browser because row-level security protects data) |
| `SUPABASE_ACCESS_TOKEN` | CLI | supabase.com → Account → Access Tokens |
| `SUPABASE_DB_PASSWORD` | CLI | the password chosen when creating the project |

Never put the `service_role` key in the app or in any `VITE_` variable.

## 3. Create the database schema

The migrations in `supabase/migrations/` build the whole schema from scratch.

```bash
npx supabase link --project-ref <project-ref>
npx supabase db push
```

To rebuild a local database from scratch, run `npx supabase start` and then `npx supabase db reset`. This needs Docker, which the devcontainer doesn't include.

## 4. Auth settings (Dashboard → Authentication)

- **URL Configuration**
  - **Site URL:** your deployed URL (or `http://localhost:5173` for local work).
  - **Redirect URLs:** add every origin you use, with `/**`:
    - `http://localhost:5173/**`
    - `https://*.app.github.dev/**` (Codespaces)
    - your deployed URL
- **Email:** keep **Confirm email** and **Secure password change** on. The built-in mailer is rate-limited (a few emails per hour). That's fine for a small group; add custom SMTP under **Emails → SMTP** if it becomes a problem (decision D11).
- **Google**
  1. Create an OAuth client (type "Web application") in Google Cloud Console → APIs & Services → Credentials.
  2. Set the authorized redirect URI to `https://<project-ref>.supabase.co/auth/v1/callback`.
  3. Paste the client ID and secret into **Sign In / Providers → Google**.
- **Discord**
  1. Create an application at discord.com/developers → OAuth2.
  2. Add the same redirect URI.
  3. Paste the client ID and secret into **Sign In / Providers → Discord**.

`supabase/config.toml` mirrors these settings for a local Supabase stack. It reads OAuth secrets from `SUPABASE_AUTH_GOOGLE_CLIENT_ID`, `SUPABASE_AUTH_GOOGLE_SECRET`, `SUPABASE_AUTH_DISCORD_CLIENT_ID` and `SUPABASE_AUTH_DISCORD_SECRET`.

## 5. Run locally

```bash
npm install
npm run dev -- --host     # --host lets Codespaces forward port 5173
npm test                  # content and rules tests
npm run content           # re-parse and validate the SRD packs (only after changing parsers or errata)
```

## 6. Deploy (Cloudflare Pages, Netlify or Vercel)

| Setting | Value |
|---|---|
| Build command | `npm run build` |
| Output directory | `dist` |
| Environment variables | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

The app uses client-side routes, so add a single-page-app fallback:

| Host | Fallback |
|---|---|
| Netlify | `public/_redirects` with `/* /index.html 200` |
| Cloudflare Pages | `public/_redirects`, same contents |
| Vercel | a `vercel.json` rewrite of `/(.*)` to `/index.html` |

After deploying, add the deployed URL to the Supabase **Site URL** and **Redirect URLs**.
