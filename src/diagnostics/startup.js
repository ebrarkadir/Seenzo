/**
 * Temporary startup diagnostics for black-screen investigations.
 * Never logs emails, tokens, secrets, or full callback URLs.
 */

const ENABLED = typeof __DEV__ !== 'undefined' && __DEV__;

export function startupLog(stage, details = {}) {
  if (!ENABLED) {
    return;
  }
  const safe = {};
  Object.keys(details || {}).forEach((key) => {
    const value = details[key];
    if (value == null || typeof value === 'boolean' || typeof value === 'number') {
      safe[key] = value;
      return;
    }
    if (typeof value === 'string') {
      // Keep short non-secret route/state labels only.
      safe[key] = value.length > 64 ? `${value.slice(0, 64)}…` : value;
    }
  });
  console.log(`[startup] ${stage}`, safe);
}
