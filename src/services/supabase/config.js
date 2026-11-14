export const SUPABASE_URL_PLACEHOLDER = 'PASTE_SUPABASE_URL_HERE';
export const SUPABASE_KEY_PLACEHOLDER = 'PASTE_PUBLISHABLE_KEY_HERE';

export function inspectSupabaseConfig(url, key) {
  const cleanUrl = String(url || '').trim();
  const cleanKey = String(key || '').trim();
  if (!cleanUrl || !cleanKey) {
    return { ready: false, reason: 'missing' };
  }
  if (cleanUrl === SUPABASE_URL_PLACEHOLDER || cleanKey === SUPABASE_KEY_PLACEHOLDER) {
    return { ready: false, reason: 'placeholder' };
  }
  if (!cleanUrl.startsWith('https://')) {
    return { ready: false, reason: 'invalidUrl' };
  }
  const lowered = cleanKey.toLowerCase();
  if (lowered.startsWith('sb_secret') || lowered.includes('service_role')) {
    return { ready: false, reason: 'unsafe' };
  }
  return { ready: true, reason: 'ready' };
}

export function getSupabaseConfig() {
  return inspectSupabaseConfig(
    process.env.EXPO_PUBLIC_SUPABASE_URL,
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}
