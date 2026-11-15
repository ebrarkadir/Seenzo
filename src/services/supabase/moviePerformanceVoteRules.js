/** Shared movie vote rule helpers. Server enforcement lives in movie-performance-vote. */

export function movieMediaIdFromTraktId(movieTraktId) {
  const id = Number(movieTraktId);
  if (!Number.isInteger(id) || id <= 0) {
    return null;
  }
  return `trakt-movie-${id}`;
}

export function extractMovieActorIds(peoplePayload) {
  const ids = new Set();
  (peoplePayload?.cast || []).forEach((entry) => {
    const traktId = Number(entry?.person?.ids?.trakt);
    if (Number.isInteger(traktId) && traktId > 0) {
      ids.add(traktId);
    }
  });
  return ids;
}

export function isMovieActorEligible(peoplePayload, personTraktId) {
  const personId = Number(personTraktId);
  if (!Number.isInteger(personId) || personId <= 0) {
    return false;
  }
  return extractMovieActorIds(peoplePayload).has(personId);
}

export function parseMovieVoteRequestBody(body) {
  const action = body?.action === 'clear' ? 'clear' : body?.action === 'cast' ? 'cast' : null;
  const movieTraktId = Number(body?.movieTraktId);
  const personTraktId = body?.personTraktId == null ? null : Number(body.personTraktId);
  const validIds = Number.isInteger(movieTraktId) && movieTraktId > 0;
  if (!action || !validIds) {
    return { ok: false, error: 'invalid_request' };
  }
  if (action === 'cast' && (!Number.isInteger(personTraktId) || personTraktId <= 0)) {
    return { ok: false, error: 'invalid_person' };
  }
  return {
    ok: true,
    action,
    movieTraktId,
    personTraktId: action === 'cast' ? personTraktId : null,
  };
}
