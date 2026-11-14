import 'react-native-url-polyfill/auto';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

import { getSupabaseConfig } from './config';

let client = null;
let lifecycleBound = false;

function bindAppState(supabase) {
  if (lifecycleBound) {
    return;
  }
  lifecycleBound = true;
  AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      supabase.auth.startAutoRefresh();
      return;
    }
    supabase.auth.stopAutoRefresh();
  });
}

export function getSupabase() {
  if (client) {
    return client;
  }
  if (!getSupabaseConfig().ready) {
    return null;
  }
  client = createClient(
    process.env.EXPO_PUBLIC_SUPABASE_URL.trim(),
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY.trim(),
    {
      auth: {
        storage: AsyncStorage,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    }
  );
  bindAppState(client);
  return client;
}
