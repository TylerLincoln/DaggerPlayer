import type { Session, User } from "@supabase/supabase-js";
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Navigate, useLocation } from "react-router";
import { supabase, supabaseConfigured } from "../../data/supabase.ts";

interface AuthState {
  session: Session | null;
  user: User | null;
  /** true until the stored session has been read */
  loading: boolean;
  /** set after the user follows a password-reset link */
  recovering: boolean;
}

const AuthContext = createContext<AuthState>({ session: null, user: null, loading: true, recovering: false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, user: null, loading: supabaseConfigured, recovering: false });

  useEffect(() => {
    if (!supabaseConfigured) return;
    supabase.auth.getSession().then(({ data }) => setState((s) => ({ ...s, session: data.session, user: data.session?.user ?? null, loading: false })));
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      setState((s) => ({
        session,
        user: session?.user ?? null,
        loading: false,
        recovering: event === "PASSWORD_RECOVERY" ? true : event === "SIGNED_OUT" ? false : s.recovering,
      }));
    });
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthContext.Provider value={state}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);

/** Sends signed-out visitors to sign in, then back here. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <p role="status">Loading…</p>;
  if (!user) return <Navigate to={`/auth/sign-in?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <>{children}</>;
}
