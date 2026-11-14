import { normalizeTracking } from './watchlist';
import { emptyStamps, hasTrackingRecords } from './cloudState';

export const LEGACY_TRACKING_KEY = 'seenzo.tracking.v1';
export const GUEST_TRACKING_KEY = 'seenzo.tracking.v1.guest';
export const GUEST_ARCHIVE_KEY = 'seenzo.tracking.v1.guest.archive';
export const GUEST_FRESH_KEY = 'seenzo.guest.fresh';

export function accountStorageKey(userId) {
  return `seenzo.tracking.v1.account.${userId}`;
}

export function emptyGuestState() {
  return normalizeTracking(null);
}

export async function markGuestFresh(storage) {
  await storage.setItem(GUEST_FRESH_KEY, '1');
}

export async function isGuestFresh(storage) {
  return (await storage.getItem(GUEST_FRESH_KEY)) === '1';
}

function stampsFrom(value) {
  const media = value?.media && typeof value.media === 'object' ? value.media : {};
  const episodes = value?.episodes && typeof value.episodes === 'object' ? value.episodes : {};
  return { media: { ...media }, episodes: { ...episodes } };
}

export async function readGuestTracking(storage) {
  const guest = await storage.getItem(GUEST_TRACKING_KEY);
  if (guest) {
    return normalizeTracking(JSON.parse(guest));
  }
  const legacy = await storage.getItem(LEGACY_TRACKING_KEY);
  if (!legacy) {
    return normalizeTracking(null);
  }
  const state = normalizeTracking(JSON.parse(legacy));
  await storage.setItem(GUEST_TRACKING_KEY, JSON.stringify(state));
  return state;
}

export async function readGuestSession(storage) {
  if (await isGuestFresh(storage)) {
    return emptyGuestState();
  }
  return readGuestTracking(storage);
}

export async function writeGuestTracking(storage, state) {
  await storage.setItem(GUEST_TRACKING_KEY, JSON.stringify(normalizeTracking(state)));
}

export async function writeGuestSession(storage, state) {
  const next = normalizeTracking(state);
  if (await isGuestFresh(storage)) {
    if (!hasTrackingRecords(next) && !next.onboardingComplete) {
      return { wrote: false, fresh: true };
    }
    const existing = await storage.getItem(GUEST_TRACKING_KEY);
    if (existing && !(await storage.getItem(GUEST_ARCHIVE_KEY))) {
      await storage.setItem(GUEST_ARCHIVE_KEY, existing);
    }
    await storage.removeItem(GUEST_FRESH_KEY);
  }
  await writeGuestTracking(storage, next);
  return { wrote: true, fresh: false };
}

export async function readAccountEnvelope(storage, userId) {
  const raw = await storage.getItem(accountStorageKey(userId));
  if (!raw) {
    return null;
  }
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || !parsed.state || !parsed.server) {
    return null;
  }
  return {
    state: normalizeTracking(parsed.state),
    server: normalizeTracking(parsed.server),
    stamps: stampsFrom(parsed.stamps),
  };
}

export async function writeAccountEnvelope(storage, userId, envelope) {
  await storage.setItem(accountStorageKey(userId), JSON.stringify({
    state: normalizeTracking(envelope.state),
    server: normalizeTracking(envelope.server),
    stamps: stampsFrom(envelope.stamps || emptyStamps()),
  }));
}
