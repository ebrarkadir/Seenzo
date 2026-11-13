export const TRAKT_CLIENT_ID_PLACEHOLDER = 'PASTE_YOUR_CLIENT_ID_HERE';

export function inspectTraktClientId(clientId) {
  const value = typeof clientId === 'string' ? clientId.trim() : '';
  if (!value) {
    return { ready: false, reason: 'missing' };
  }
  if (value === TRAKT_CLIENT_ID_PLACEHOLDER) {
    return { ready: false, reason: 'placeholder' };
  }
  return { ready: true, reason: 'ready' };
}

export function getTraktConfigStatus() {
  return inspectTraktClientId(process.env.EXPO_PUBLIC_TRAKT_CLIENT_ID);
}
