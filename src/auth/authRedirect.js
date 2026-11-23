export const AUTH_SCHEME = 'seenzo';
export const AUTH_CALLBACK_PATH = 'auth/callback';

/**
 * Native custom-scheme callback for email confirmation.
 * Requires a development or production build — not Expo Go.
 * Never point email redirects at localhost or Metro.
 */
export function getAuthEmailRedirectTo() {
  return `${AUTH_SCHEME}://${AUTH_CALLBACK_PATH}`;
}

export function isAuthCallbackUrl(url) {
  if (!url || typeof url !== 'string') {
    return false;
  }
  const lowered = url.toLowerCase();
  return lowered.startsWith(`${AUTH_SCHEME}://`)
    && (lowered.includes('auth/callback') || lowered.includes('://auth/callback'));
}
