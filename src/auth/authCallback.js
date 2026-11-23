import { getSupabase } from '../services/supabase/client';
import { isAuthCallbackUrl } from './authRedirect';

const processedUrls = new Set();
const EXCHANGE_TIMEOUT_MS = 20000;
export const PKCE_FLOW_ID_PARAM = 'sb_flow_id';

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

function withTimeout(promise, ms, code = 'link_timeout') {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(markCoded(code)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    clearTimeout(timer);
  });
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
  const error = String(params.error || params.error_code || cause?.code || cause?.name || '').toLowerCase();
  const description = String(params.error_description || cause?.message || '').toLowerCase();
  if (error.includes('otp_expired') || description.includes('expired') || error.includes('expired')) {
    return markCoded('link_expired', cause);
  }
  if (error.includes('access_denied') || description.includes('already') || description.includes('used')) {
    return markCoded('link_used', cause);
  }
  if (
    description.includes('flow state')
    || description.includes('code verifier')
    || error.includes('pkce')
    || error.includes('authpkce')
  ) {
    return markCoded('link_device_mismatch', cause);
  }
  if (error.includes('link_timeout') || description.includes('timeout')) {
    return markCoded('link_timeout', cause);
  }
  if (error || description) {
    return markCoded('link_invalid', cause);
  }
  return markCoded('link_invalid', cause);
}

async function readExistingSession(supabase) {
  try {
    const { data, error } = await withTimeout(supabase.auth.getSession(), 8000, 'link_timeout');
    if (error) {
      return null;
    }
    return data?.session || null;
  } catch {
    return null;
  }
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

  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('missing');
  }

  if (processedUrls.has(url)) {
    const existing = await readExistingSession(supabase);
    if (existing) {
      return { status: 'ok', session: existing, duplicate: true };
    }
    return { status: 'duplicate', session: null };
  }
  processedUrls.add(url);

  const params = parseAuthCallbackParams(url);
  if (params.error || params.error_code) {
    processedUrls.delete(url);
    throw mapAuthCallbackError(params);
  }

  const existingSession = await readExistingSession(supabase);

  try {
    if (params.code) {
      const flowId = params[PKCE_FLOW_ID_PARAM] || params.flow_id || null;
      const exchange = supabase.auth.exchangeCodeForSession(
        params.code,
        flowId ? { flowId } : undefined,
      );
      const { data, error } = await withTimeout(exchange, EXCHANGE_TIMEOUT_MS, 'link_timeout');
      if (error) {
        // Valid local session may already exist from a prior successful exchange.
        const fallback = existingSession || await readExistingSession(supabase);
        if (fallback) {
          return { status: 'ok', session: fallback, recovered: true };
        }
        processedUrls.delete(url);
        throw mapAuthCallbackError(params, error);
      }
      const session = data.session ?? null;
      if (!session) {
        const fallback = existingSession || await readExistingSession(supabase);
        if (fallback) {
          return { status: 'ok', session: fallback, recovered: true };
        }
        processedUrls.delete(url);
        throw markCoded('link_invalid');
      }
      return { status: 'ok', session };
    }

    if (params.token_hash) {
      const type = params.type || 'email';
      const { data, error } = await withTimeout(
        supabase.auth.verifyOtp({
          token_hash: params.token_hash,
          type,
        }),
        EXCHANGE_TIMEOUT_MS,
        'link_timeout',
      );
      if (error) {
        const fallback = existingSession || await readExistingSession(supabase);
        if (fallback) {
          return { status: 'ok', session: fallback, recovered: true };
        }
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
      const { data, error } = await withTimeout(
        supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        }),
        EXCHANGE_TIMEOUT_MS,
        'link_timeout',
      );
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
  } catch (error) {
    if (error?.code) {
      throw error;
    }
    processedUrls.delete(url);
    throw mapAuthCallbackError(params, error);
  }
}

export function resetAuthCallbackProcessingForTests() {
  processedUrls.clear();
}
