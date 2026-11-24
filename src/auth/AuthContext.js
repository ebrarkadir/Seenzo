import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getAuthEmailRedirectTo } from './authRedirect';
import { normalizeAuthEmail, validateEmail } from './messages';
import { logoutLog } from '../diagnostics/logout';
import { startupLog } from '../diagnostics/startup';
import { getSupabaseConfig } from '../services/supabase/config';
import { getSupabase } from '../services/supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const config = getSupabaseConfig();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!config.ready);

  useEffect(() => {
    let active = true;
    let supabase;
    try {
      supabase = getSupabase();
    } catch (error) {
      startupLog('auth_client_failed', { reason: error?.message || 'client' });
      Promise.resolve().then(() => {
        if (!active) {
          return;
        }
        setSession(null);
        setReady(true);
      });
      return () => {
        active = false;
      };
    }
    if (!supabase) {
      startupLog('auth_ready', { session: false, configReady: false });
      Promise.resolve().then(() => {
        if (!active) {
          return;
        }
        setReady(true);
      });
      return () => {
        active = false;
      };
    }
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return;
      }
      const next = error ? null : data.session ?? null;
      setSession(next);
      setReady(true);
      startupLog('auth_ready', { session: Boolean(next?.user?.id) });
    }).catch(() => {
      if (active) {
        setSession(null);
        setReady(true);
        startupLog('auth_ready', { session: false, recovered: true });
      }
    });
    const { data } = supabase.auth.onAuthStateChange((event, nextSession) => {
      // Ignore remote events that would re-auth after an intentional local logout
      // until storage has been cleared; local signOut still emits SIGNED_OUT.
      setSession(nextSession ?? null);
      setReady(true);
      if (event === 'SIGNED_OUT') {
        logoutLog('auth_state_updated', { signedIn: false, event });
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) {
      return { error: { message: 'missing' } };
    }
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizeAuthEmail(email),
      password,
    });
    if (error) {
      return { error };
    }
    setSession(data.session ?? null);
    return { session: data.session ?? null };
  }, []);

  const signUp = useCallback(async (email, password) => {
    const supabase = getSupabase();
    if (!supabase) {
      return { error: { message: 'missing' } };
    }
    const { data, error } = await supabase.auth.signUp({
      email: normalizeAuthEmail(email),
      password,
      options: {
        emailRedirectTo: getAuthEmailRedirectTo(),
      },
    });
    if (error) {
      return { error };
    }
    const identities = data.user?.identities;
    if (Array.isArray(identities) && identities.length === 0) {
      return { session: null, existingAccount: true };
    }
    setSession(data.session ?? null);
    return { session: data.session ?? null, confirmationRequired: !data.session };
  }, []);

  const resendConfirmation = useCallback(async (email) => {
    const supabase = getSupabase();
    if (!supabase) {
      return { error: { message: 'missing' } };
    }
    const normalized = normalizeAuthEmail(email);
    if (!validateEmail(normalized)) {
      return { error: { code: 'email_address_invalid', message: 'Email address is invalid' } };
    }
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: normalized,
      options: {
        emailRedirectTo: getAuthEmailRedirectTo(),
      },
    });
    if (error) {
      return { error };
    }
    return { ok: true };
  }, []);

  const signOut = useCallback(async () => {
    logoutLog('signout_started');
    const supabase = getSupabase();
    // Clear React auth state immediately so routing cannot wait on storage/network.
    setSession(null);
    logoutLog('auth_state_updated', { signedIn: false, phase: 'optimistic' });

    if (!supabase) {
      logoutLog('local_session_cleared', { mode: 'no_client' });
      return { error: null };
    }

    const LOCAL_TIMEOUT_MS = 4000;
    let error = null;
    let timedOut = false;
    try {
      const result = await Promise.race([
        supabase.auth.signOut({ scope: 'local' }),
        new Promise((resolve) => {
          setTimeout(() => resolve({ error: { message: 'sign_out_timeout' } }), LOCAL_TIMEOUT_MS);
        }),
      ]);
      error = result?.error || null;
      timedOut = error?.message === 'sign_out_timeout';
    } catch (requestError) {
      error = requestError;
    }

    // Ensure session stays cleared even if a late auth event raced in.
    setSession(null);
    logoutLog('local_session_cleared', {
      timedOut,
      hasError: Boolean(error && !timedOut),
    });

    // Best-effort remote revoke only — never blocks navigation.
    Promise.resolve(supabase.auth.signOut({ scope: 'global' })).catch(() => {});
    return { error: timedOut ? null : error };
  }, []);

  const value = useMemo(() => ({
    ready,
    config,
    session,
    email: session?.user?.email || '',
    signIn,
    signUp,
    resendConfirmation,
    signOut,
  }), [config, ready, resendConfirmation, session, signIn, signOut, signUp]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
