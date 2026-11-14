import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { normalizeAuthEmail } from './messages';
import { getSupabaseConfig } from '../services/supabase/config';
import { getSupabase } from '../services/supabase/client';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const config = getSupabaseConfig();
  const [session, setSession] = useState(null);
  const [ready, setReady] = useState(!config.ready);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) {
      return undefined;
    }
    let active = true;
    supabase.auth.getSession().then(({ data, error }) => {
      if (!active) {
        return;
      }
      setSession(error ? null : data.session ?? null);
      setReady(true);
    }).catch(() => {
      if (active) {
        setSession(null);
        setReady(true);
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

  const signOut = useCallback(async () => {
    const supabase = getSupabase();
    if (!supabase) {
      setSession(null);
      return { error: null };
    }
    const { error } = await supabase.auth.signOut();
    if (!error) {
      setSession(null);
    }
    return { error };
  }, []);

  const value = useMemo(() => ({
    ready,
    config,
    session,
    email: session?.user?.email || '',
    signIn,
    signUp,
    signOut,
  }), [config, ready, session, signIn, signOut, signUp]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return context;
}
