import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { getAuthEmailRedirectTo } from './authRedirect';
import { normalizeAuthEmail, validateEmail } from './messages';
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
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession ?? null);
      setReady(true);
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
    const supabase = getSupabase();
    if (!supabase) {
      setSession(null);
      return { error: null };
    }
    const { error } = await supabase.auth.signOut();
    // Always clear local session so a failed network sign-out cannot leave
    // the UI stuck in an authenticated state.
    setSession(null);
    return { error };
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
