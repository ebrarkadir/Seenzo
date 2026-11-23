import { getSupabase } from '../services/supabase/client';
import { isAuthCallbackUrl } from './authRedirect';

const processedUrls = new Set();

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

/**
 * Parse query + hash params without logging the raw URL (tokens may be present).
 */
export function parseAuthCallbackParams(url) {
  const params = {};
  if (!url || typeof url !== 'string') {
    return params;
  }
  const hashIndex = url.indexOf('#');
  const queryIndex = url.indexOf('?');
  const collect = (raw) => {
    if (!raw) {
      return;
    }
    const search = raw.startsWith('?') || raw.startsWith('#') ? raw.slice(1) : raw;
    for (const part of search.split('&')) {
      if (!part) {
        continue;
      }
      const eq = part.indexOf('=');
      const key = decodeURIComponent(eq >= 0 ? part.slice(0, eq) : part);
      const value = decodeURIComponent(eq >= 0 ? part.slice(eq + 1) : '');
      if (key) {
        params[key] = value;
      }
    }
  };
  if (queryIndex >= 0) {
    collect(url.slice(queryIndex, hashIndex >= 0 ? hashIndex : undefined));
  }
  if (hashIndex >= 0) {
    collect(url.slice(hashIndex));
  }
  return params;
}

export function mapAuthCallbackError(params = {}, cause) {
  const error = String(params.error || params.error_code || cause?.code || '').toLowerCase();
  const description = String(params.error_description || cause?.message || '').toLowerCase();
  if (error.includes('otp_expired') || description.includes('expired') || error.includes('expired')) {
    return markCoded('link_expired', cause);
  }
  if (error.includes('access_denied') || description.includes('already') || description.includes('used')) {
    return markCoded('link_used', cause);
  }
  if (description.includes('flow state') || description.includes('code verifier')) {
    return markCoded('link_device_mismatch', cause);
  }
  if (error || description) {
    return markCoded('link_invalid', cause);
  }
  return markCoded('link_invalid', cause);
}

/**
 * Establish a session from a native auth callback URL exactly once.
 * Supports PKCE (?code=), implicit tokens (#access_token), and token_hash verifyOtp.
 */
export async function completeAuthCallbackFromUrl(url) {
  if (!url || typeof url !== 'string') {
    throw markCoded('link_invalid');
  }
  if (!isAuthCallbackUrl(url) && !url.includes('code=') && !url.includes('access_token') && !url.includes('token_hash')) {
    throw markCoded('link_invalid');
  }
  if (processedUrls.has(url)) {
    return { status: 'duplicate', session: null };
  }
  processedUrls.add(url);

  const supabase = getSupabase();
  if (!supabase) {
    processedUrls.delete(url);
    throw markCoded('missing');
  }

  const params = parseAuthCallbackParams(url);
  if (params.error || params.error_code) {
    throw mapAuthCallbackError(params);
  }

  const existing = await supabase.auth.getSession();
  const existingSession = existing.data?.session || null;

  if (params.code) {
    const { data, error } = await supabase.auth.exchangeCodeForSession(params.code);
    if (error) {
      processedUrls.delete(url);
      throw mapAuthCallbackError(params, error);
    }
    return { status: 'ok', session: data.session ?? null };
  }

  if (params.token_hash) {
    const type = params.type || 'email';
    const { data, error } = await supabase.auth.verifyOtp({
      token_hash: params.token_hash,
      type,
    });
    if (error) {
      processedUrls.delete(url);
      throw mapAuthCallbackError(params, error);
    }
    return { status: 'ok', session: data.session ?? null };
  }

  if (params.access_token && params.refresh_token) {
    if (
      existingSession?.access_token
      && existingSession.access_token === params.access_token
    ) {
      return { status: 'ok', session: existingSession };
    }
    const { data, error } = await supabase.auth.setSession({
      access_token: params.access_token,
      refresh_token: params.refresh_token,
    });
    if (error) {
      processedUrls.delete(url);
      throw mapAuthCallbackError(params, error);
    }
    return { status: 'ok', session: data.session ?? null };
  }

  if (existingSession) {
    return { status: 'ok', session: existingSession };
  }

  processedUrls.delete(url);
  throw markCoded('link_invalid');
}

export function resetAuthCallbackProcessingForTests() {
  processedUrls.clear();
}
