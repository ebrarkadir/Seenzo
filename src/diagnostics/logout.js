/**
 * Temporary logout diagnostics. Never logs tokens, emails, or passwords.
 */

const ENABLED = typeof __DEV__ !== 'undefined' && __DEV__;

export function logoutLog(stage, details = {}) {
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
      safe[key] = value.length > 48 ? `${value.slice(0, 48)}…` : value;
    }
  });
  console.log(`[logout] ${stage}`, safe);
}
