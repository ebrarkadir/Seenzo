import { traktGet } from './client';
import { pickHeadshotPath } from './normalize';

const memory = new Map();
const inflight = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000;

const CREW_ORDER = [
  'created by',
  'directing',
  'writing',
  'production',
  'camera',
  'editing',
  'sound',
  'art',
  'costume & make-up',
  'visual effects',
  'lighting',
  'crew',
];

function cacheGet(key) {
  const hit = memory.get(key);
  if (!hit || Date.now() - hit.at > CACHE_TTL_MS) {
    return null;
  }
  return hit.value;
}

function cacheSet(key, value) {
  memory.set(key, { at: Date.now(), value });
  return value;
}

function textList(value) {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || '').trim()).filter(Boolean);
  }
  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }
  return [];
}

function toPerson(entry) {
  const person = entry?.person;
  const traktId = person?.ids?.trakt;
  if (!traktId || !person?.name) {
    return null;
  }
  return {
    personId: Number(traktId),
    name: person.name,
    characters: textList(entry.characters?.length ? entry.characters : entry.character),
    jobs: textList(entry.jobs?.length ? entry.jobs : entry.job),
    episodeCount: typeof entry.episode_count === 'number' ? entry.episode_count : null,
    headshotPath: pickHeadshotPath(person.images),
  };
}

export function normalizePeoplePayload(payload) {
  const cast = Array.isArray(payload?.cast) ? payload.cast.map(toPerson).filter(Boolean) : [];
  const guestStars = Array.isArray(payload?.guest_stars)
    ? payload.guest_stars.map(toPerson).filter(Boolean)
    : [];
  const crewByDepartment = {};
  const crewSource = payload?.crew && typeof payload.crew === 'object' && !Array.isArray(payload.crew)
    ? payload.crew
    : {};
  Object.entries(crewSource).forEach(([department, people]) => {
    if (!Array.isArray(people) || !people.length) {
      return;
    }
    const mapped = people.map(toPerson).filter(Boolean);
    if (!mapped.length) {
      return;
    }
    crewByDepartment[department] = mapped;
  });
  const departments = Object.keys(crewByDepartment).sort((left, right) => {
    const leftIndex = CREW_ORDER.indexOf(left);
    const rightIndex = CREW_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) {
      return left.localeCompare(right);
    }
    if (leftIndex === -1) {
      return 1;
    }
    if (rightIndex === -1) {
      return -1;
    }
    return leftIndex - rightIndex;
  });
  return {
    cast,
    guestStars,
    crewByDepartment,
    departments,
  };
}

async function loadPeople(cacheKey, path, query) {
  const cached = cacheGet(cacheKey);
  if (cached) {
    return cached;
  }
  const pending = inflight.get(cacheKey);
  if (pending) {
    return pending;
  }
  const task = traktGet(path, query)
    .then((result) => cacheSet(cacheKey, normalizePeoplePayload(result.data)))
    .finally(() => inflight.delete(cacheKey));
  inflight.set(cacheKey, task);
  return task;
}

export function fetchShowPeople(traktShowId) {
  const id = String(traktShowId || '').trim();
  if (!id) {
    return Promise.reject(new Error('invalid'));
  }
  return loadPeople(
    `show-people:${id}`,
    `/shows/${encodeURIComponent(id)}/people`,
    { extended: 'full' }
  );
}

export function fetchEpisodePeople(traktShowId, seasonNumber, episodeNumber) {
  const id = String(traktShowId || '').trim();
  const season = Number(seasonNumber);
  const episode = Number(episodeNumber);
  if (!id || !Number.isInteger(season) || season < 0 || !Number.isInteger(episode) || episode < 1) {
    return Promise.reject(new Error('invalid'));
  }
  return loadPeople(
    `episode-people:${id}:${season}:${episode}`,
    `/shows/${encodeURIComponent(id)}/seasons/${season}/episodes/${episode}/people`,
    { extended: 'full,guest_stars' }
  );
}

/** Episode-only actors: cast + guest stars, deduped by Trakt person id. No crew. */
export function collectEpisodeActors(people) {
  const actors = [];
  const seen = new Set();
  const push = (person, isGuest) => {
    if (!person?.personId || seen.has(person.personId)) {
      return;
    }
    seen.add(person.personId);
    actors.push({
      ...person,
      isGuest: Boolean(isGuest),
    });
  };
  (people?.cast || []).forEach((person) => push(person, false));
  (people?.guestStars || []).forEach((person) => push(person, true));
  return actors;
}

export function clearPeopleCache() {
  memory.clear();
}
