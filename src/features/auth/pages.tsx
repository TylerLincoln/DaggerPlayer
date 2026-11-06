import { type FormEvent, useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";
import { authRedirect, supabase } from "../../data/supabase.ts";
import { Field, FormMessage, errorText } from "../../ui/forms.tsx";
import { useAuth } from "./AuthProvider.tsx";

/** Only same-site paths are allowed as a post-login destination. */
export function safeNext(next: string | null, fallback = "/account") {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : fallback;
}

function useBusy() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await fn();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, info, setInfo, run };
}

function OAuthButtons({ next }: { next: string }) {
  const { busy, error, run } = useBusy();
  const go = (provider: "google" | "discord") =>
    run(async () => {
      const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: authRedirect(`/auth/callback?next=${encodeURIComponent(next)}`) } });
      if (error) throw error;
    });
  return (
    <div className="oauth">
      <button type="button" disabled={busy} onClick={() => go("google")}>
        Continue with Google
      </button>
      <button type="button" disabled={busy} onClick={() => go("discord")}>
        Continue with Discord
      </button>
      <FormMessage error={error} />
    </div>
  );
}

export function SignInPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"password" | "link">("password");
  const { busy, error, info, setInfo, run } = useBusy();

  useEffect(() => {
    if (user) navigate(next, { replace: true });
  }, [user, next, navigate]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      if (mode === "password") {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else {
        const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: authRedirect(`/auth/callback?next=${encodeURIComponent(next)}`) } });
        if (error) throw error;
        setInfo("Check your email for a sign-in link.");
      }
    });
  };

  return (
    <section className="auth-card" aria-labelledby="signin-title">
      <h1 id="signin-title">Sign in</h1>
      <div role="tablist" aria-label="Sign-in method" className="segmented">
        <button role="tab" type="button" aria-selected={mode === "password"} onClick={() => setMode("password")}>
          Password
        </button>
        <button role="tab" type="button" aria-selected={mode === "link"} onClick={() => setMode("link")}>
          Email me a link
        </button>
      </div>
      <form onSubmit={submit}>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        {mode === "password" && (
          <Field label="Password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        )}
        <button className="primary" disabled={busy}>
          {mode === "password" ? "Sign in" : "Send link"}
        </button>
        <FormMessage error={error} info={info} />
      </form>
      <OAuthButtons next={next} />
      <p>
        <Link to="/auth/forgot">Forgot your password?</Link> · <Link to={`/auth/sign-up?next=${encodeURIComponent(next)}`}>Create an account</Link>
      </p>
    </section>
  );
}

export function SignUpPage() {
  const [params] = useSearchParams();
  const next = safeNext(params.get("next"));
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const { busy, error, run } = useBusy();

  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { full_name: name || undefined }, emailRedirectTo: authRedirect(`/auth/callback?next=${encodeURIComponent(next)}`) },
      });
      if (error) throw error;
      // With email confirmation on, there's no session until the link is clicked.
      if (!data.session) navigate(`/auth/check-email?email=${encodeURIComponent(email)}`);
      else navigate(next);
    });
  };

  return (
    <section className="auth-card" aria-labelledby="signup-title">
      <h1 id="signup-title">Create an account</h1>
      <p>An account saves your characters, homebrew and settings. You can browse the compendium and try the builder without one.</p>
      <form onSubmit={submit}>
        <Field label="Display name (optional)" autoComplete="nickname" maxLength={80} value={name} onChange={(e) => setName(e.target.value)} />
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <Field label="Password" type="password" autoComplete="new-password" required minLength={8} hint="At least 8 characters." value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="primary" disabled={busy}>
          Create account
        </button>
        <FormMessage error={error} />
      </form>
      <OAuthButtons next={next} />
      <p>
        Already have an account? <Link to={`/auth/sign-in?next=${encodeURIComponent(next)}`}>Sign in</Link>
      </p>
    </section>
  );
}

export function CheckEmailPage() {
  const [params] = useSearchParams();
  const email = params.get("email") ?? "";
  const { busy, error, info, setInfo, run } = useBusy();
  const resend = () =>
    run(async () => {
      const { error } = await supabase.auth.resend({ type: "signup", email, options: { emailRedirectTo: authRedirect() } });
      if (error) throw error;
      setInfo("Sent again.");
    });
  return (
    <section className="auth-card" aria-labelledby="check-title">
      <h1 id="check-title">Check your email</h1>
      <p>We sent a confirmation link{email ? ` to ${email}` : ""}. Open it on this device to finish signing up.</p>
      {email && (
        <button type="button" disabled={busy} onClick={resend}>
          Resend the email
        </button>
      )}
      <FormMessage error={error} info={info} />
    </section>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const { busy, error, info, setInfo, run } = useBusy();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo: authRedirect("/auth/reset") });
      if (error) throw error;
      setInfo("If that address has an account, a reset link is on its way.");
    });
  };
  return (
    <section className="auth-card" aria-labelledby="forgot-title">
      <h1 id="forgot-title">Reset your password</h1>
      <form onSubmit={submit}>
        <Field label="Email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
        <button className="primary" disabled={busy}>
          Send reset link
        </button>
        <FormMessage error={error} info={info} />
      </form>
    </section>
  );
}

/** Landing page for the reset link: the link signs the user in, then they choose a new password. */
export function ResetPasswordPage() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const { busy, error, run } = useBusy();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      navigate("/account", { replace: true, state: { notice: "Password updated." } });
    });
  };
  if (loading) return <p role="status">Loading…</p>;
  if (!user)
    return (
      <section className="auth-card">
        <h1>Reset link expired</h1>
        <p>
          The link is invalid or has expired. <Link to="/auth/forgot">Request a new one</Link>.
        </p>
      </section>
    );
  return (
    <section className="auth-card" aria-labelledby="reset-title">
      <h1 id="reset-title">Choose a new password</h1>
      <form onSubmit={submit}>
        <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="primary" disabled={busy}>
          Save password
        </button>
        <FormMessage error={error} />
      </form>
    </section>
  );
}

/** Email confirmation, magic links and OAuth all return here; supabase-js exchanges the code in the URL. */
export function AuthCallbackPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const { user, loading } = useAuth();
  const failure = params.get("error_description");
  useEffect(() => {
    if (!loading && user) navigate(safeNext(params.get("next")), { replace: true });
  }, [user, loading, params, navigate]);
  if (failure)
    return (
      <section className="auth-card">
        <h1>Sign-in failed</h1>
        <FormMessage error={failure} />
        <Link to="/auth/sign-in">Try again</Link>
      </section>
    );
  if (!loading && !user)
    return (
      <section className="auth-card">
        <h1>Link expired</h1>
        <p>
          This link is invalid or was already used. <Link to="/auth/sign-in">Sign in</Link>.
        </p>
      </section>
    );
  return <p role="status">Signing you in…</p>;
}
