import { type FormEvent, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { deleteMyAccount, exportAllData } from "../../data/repo.ts";
import { authRedirect, supabase } from "../../data/supabase.ts";
import { Field, FormMessage, errorText } from "../../ui/forms.tsx";
import { useAuth } from "../auth/AuthProvider.tsx";

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      const msg = await fn();
      if (msg) setInfo(msg);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, info, run };
}

function ChangeEmail() {
  const [email, setEmail] = useState("");
  const a = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => {
      const { error } = await supabase.auth.updateUser({ email }, { emailRedirectTo: authRedirect("/account") });
      if (error) throw error;
      return "Confirm the change from the links sent to both your old and new addresses.";
    });
  };
  return (
    <form onSubmit={submit} aria-labelledby="email-h">
      <h2 id="email-h">Change email</h2>
      <Field label="New email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      <button disabled={a.busy}>Change email</button>
      <FormMessage error={a.error} info={a.info} />
    </form>
  );
}

function ChangePassword() {
  const [password, setPassword] = useState("");
  const [nonce, setNonce] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const a = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => {
      const { error } = await supabase.auth.updateUser(needsCode ? { password, nonce } : { password });
      if (error) {
        // Secure password change: sessions older than 24h must confirm with an emailed code.
        if (/reauthenticat/i.test(error.message) && !needsCode) {
          const r = await supabase.auth.reauthenticate();
          if (r.error) throw r.error;
          setNeedsCode(true);
          return "We emailed you a confirmation code. Enter it below and save again.";
        }
        throw error;
      }
      setPassword("");
      setNonce("");
      setNeedsCode(false);
      return "Password updated.";
    });
  };
  return (
    <form onSubmit={submit} aria-labelledby="pw-h">
      <h2 id="pw-h">Change password</h2>
      <Field label="New password" type="password" autoComplete="new-password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} />
      {needsCode && <Field label="Confirmation code" inputMode="numeric" autoComplete="one-time-code" required value={nonce} onChange={(e) => setNonce(e.target.value)} />}
      <button disabled={a.busy}>Save password</button>
      <FormMessage error={a.error} info={a.info} />
    </form>
  );
}

function ExportData() {
  const a = useAction();
  const download = () =>
    a.run(async () => {
      const data = await exportAllData();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `daggerplayer-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      return "Export downloaded.";
    });
  return (
    <section aria-labelledby="export-h">
      <h2 id="export-h">Export my data</h2>
      <p>Download everything stored for your account (characters, history, homebrew, settings) as JSON.</p>
      <button type="button" disabled={a.busy} onClick={download}>
        Download export
      </button>
      <FormMessage error={a.error} info={a.info} />
    </section>
  );
}

function DeleteAccount() {
  const [confirm, setConfirm] = useState("");
  const navigate = useNavigate();
  const a = useAction();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => {
      await deleteMyAccount();
      navigate("/", { replace: true });
    });
  };
  return (
    <form onSubmit={submit} aria-labelledby="delete-h" className="danger-zone">
      <h2 id="delete-h">Delete account</h2>
      <p>This permanently deletes your account and all its data: characters, history, homebrew and settings. It can't be undone. Export first if you want a copy.</p>
      <Field label='Type "DELETE" to confirm' autoComplete="off" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      <button className="danger" disabled={a.busy || confirm !== "DELETE"}>
        Delete my account
      </button>
      <FormMessage error={a.error} />
    </form>
  );
}

export function AccountPage() {
  const { user } = useAuth();
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice;
  const signOut = () => supabase.auth.signOut();
  return (
    <div className="account">
      <h1>Account</h1>
      <FormMessage info={notice} />
      <p>
        Signed in as <strong>{user?.email}</strong>
        {user?.email_confirmed_at ? "" : " (email not verified yet)"}.{" "}
        <button type="button" onClick={signOut}>
          Sign out
        </button>
      </p>
      <ChangeEmail />
      <ChangePassword />
      <ExportData />
      <DeleteAccount />
    </div>
  );
}
