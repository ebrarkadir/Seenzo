/** Shared vote rule helpers (client tests + docs). Server enforcement lives in the Edge Function. */

export function showMediaIdFromTraktId(showTraktId) {
  const id = Number(showTraktId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return `trakt-show-${id}`;
}

export function extractEpisodeActorIds(peoplePayload) {
  const ids = new Set();
  const push = (entry) => {
    const traktId = Number(entry?.person?.ids?.trakt);
    if (Number.isInteger(traktId) && traktId > 0) {
      ids.add(traktId);
    }
  };
  (peoplePayload?.cast || []).forEach(push);
  (peoplePayload?.guest_stars || []).forEach(push);
  return ids;
}

export function isEpisodeActorEligible(peoplePayload, personTraktId) {
  const personId = Number(personTraktId);
  if (!Number.isInteger(personId) || personId <= 0) {
    return false;
  }
  return extractEpisodeActorIds(peoplePayload).has(personId);
}

export function parseVoteRequestBody(body) {
  const action = body?.action === 'clear' ? 'clear' : body?.action === 'cast' ? 'cast' : null;
  const showTraktId = Number(body?.showTraktId);
  const seasonNumber = Number(body?.seasonNumber);
  const episodeNumber = Number(body?.episodeNumber);
  const personTraktId = body?.personTraktId == null ? null : Number(body.personTraktId);
  const validIds = Number.isInteger(showTraktId)
    && showTraktId > 0
    && Number.isInteger(seasonNumber)
    && seasonNumber >= 0
    && Number.isInteger(episodeNumber)
    && episodeNumber >= 1;
  if (!action || !validIds) {
    return { ok: false, error: 'invalid_request' };
  }
  if (action === 'cast' && (!Number.isInteger(personTraktId) || personTraktId <= 0)) {
    return { ok: false, error: 'invalid_person' };
  }
  return {
    ok: true,
    action,
    showTraktId,
    seasonNumber,
    episodeNumber,
    personTraktId: action === 'cast' ? personTraktId : null,
  };
}
