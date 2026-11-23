import { isChartEligibleActivity, normalizeActivityEvents } from '../tracking/activityEvents';

const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

function resolveTimeZone(timeZone) {
  if (typeof timeZone === 'string' && timeZone) {
    return timeZone;
  }
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

function partsInZone(iso, timeZone) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);
    const year = Number(parts.find((part) => part.type === 'year')?.value);
    const month = Number(parts.find((part) => part.type === 'month')?.value);
    const day = Number(parts.find((part) => part.type === 'day')?.value);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
      return null;
    }
    return { year, month, day };
  } catch {
    return null;
  }
}

export function activityTimestamp(event) {
  if (!event) {
    return null;
  }
  return event.serverRecordedAt || event.clientLoggedAt || null;
}

export function listChartActivityEvents(events, { filter = 'all' } = {}) {
  return normalizeActivityEvents(events).filter((event) => {
    if (!isChartEligibleActivity(event)) {
      return false;
    }
    if (filter === 'movie') {
      return event.mediaType === 'movie';
    }
    if (filter === 'episode') {
      return event.mediaType === 'episode';
    }
    return filter === 'all';
  });
}

export function listActivityYears(events, options = {}) {
  const timeZone = resolveTimeZone(options.timeZone);
  const years = new Set();
  listChartActivityEvents(events, options).forEach((event) => {
    const stamp = activityTimestamp(event);
    const parts = stamp ? partsInZone(stamp, timeZone) : null;
    if (parts) {
      years.add(parts.year);
    }
  });
  return [...years].sort((left, right) => right - left);
}

export function calculateMonthlyActivity(events, {
  year,
  filter = 'all',
  timeZone,
} = {}) {
  const zone = resolveTimeZone(timeZone);
  const months = MONTHS.map((month) => ({
    month,
    movies: 0,
    episodes: 0,
    total: 0,
  }));
  if (!Number.isInteger(year)) {
    return {
      year: null,
      months,
      total: 0,
      labelKind: 'logging',
    };
  }

  listChartActivityEvents(events, { filter }).forEach((event) => {
    const stamp = activityTimestamp(event);
    const parts = stamp ? partsInZone(stamp, zone) : null;
    if (!parts || parts.year !== year) {
      return;
    }
    const bucket = months[parts.month - 1];
    if (!bucket) {
      return;
    }
    if (event.mediaType === 'movie') {
      bucket.movies += 1;
    } else if (event.mediaType === 'episode') {
      bucket.episodes += 1;
    }
    bucket.total = bucket.movies + bucket.episodes;
  });

  return {
    year,
    months,
    total: months.reduce((sum, item) => sum + item.total, 0),
    labelKind: 'logging',
  };
}

export function calculateActivitySummary(events, {
  year,
  filter = 'all',
  timeZone,
} = {}) {
  const zone = resolveTimeZone(timeZone);
  const activeDays = new Set();
  let moviesLogged = 0;
  let episodesLogged = 0;

  listChartActivityEvents(events, { filter }).forEach((event) => {
    const stamp = activityTimestamp(event);
    const parts = stamp ? partsInZone(stamp, zone) : null;
    if (!parts) {
      return;
    }
    if (Number.isInteger(year) && parts.year !== year) {
      return;
    }
    activeDays.add(`${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`);
    if (event.mediaType === 'movie') {
      moviesLogged += 1;
    } else if (event.mediaType === 'episode') {
      episodesLogged += 1;
    }
  });

  return {
    activeDays: activeDays.size,
    moviesLogged,
    episodesLogged,
  };
}

export function buildViewingActivity(events, {
  year,
  filter = 'all',
  timeZone,
} = {}) {
  const normalized = normalizeActivityEvents(events);
  const years = listActivityYears(normalized, { filter, timeZone });
  const selectedYear = Number.isInteger(year) && years.includes(year)
    ? year
    : (years[0] || null);
  const monthly = calculateMonthlyActivity(normalized, {
    year: selectedYear,
    filter,
    timeZone,
  });
  const summary = calculateActivitySummary(normalized, {
    year: selectedYear,
    filter,
    timeZone,
  });
  return {
    years,
    selectedYear,
    monthly,
    summary,
    hasLoggingEvents: years.length > 0,
    historicalIncomplete: true,
    labelKind: 'logging',
  };
}
