/** Map a 1–10 personal rating to a 0–5 star fill (half-star steps). Presentation only. */
export function starsFromRating(rating) {
  if (rating == null) {
    return 0;
  }
  const value = Number(rating);
  if (!Number.isInteger(value) || value < 1 || value > 10) {
    return 0;
  }
  return value / 2;
}

export function clampDiscreteRating(value) {
  const next = Math.round(Number(value));
  if (!Number.isFinite(next)) {
    return null;
  }
  return Math.min(10, Math.max(1, next));
}

/**
 * Interactive 5-star toggle mapped onto integer 1–10 ratings.
 * starNumber is 1–5. First tap selects full (N*2); same star toggles half (N*2-1).
 * Never clears to zero — clearing is a separate Remove action.
 */
export function toggleStarRating(currentRating, starNumber) {
  const star = Math.round(Number(starNumber));
  if (!Number.isInteger(star) || star < 1 || star > 5) {
    return currentRating == null ? null : clampDiscreteRating(currentRating);
  }
  const full = star * 2;
  const half = full - 1;
  const current = currentRating == null ? null : clampDiscreteRating(currentRating);
  if (current === full) {
    return half;
  }
  if (current === half) {
    return full;
  }
  return full;
}

export function starFillAt(rating, starNumber) {
  const fill = starsFromRating(rating);
  const remaining = fill - (starNumber - 1);
  if (remaining >= 1) {
    return 1;
  }
  if (remaining >= 0.5) {
    return 0.5;
  }
  return 0;
}

export function ratingDescriptorKey(rating) {
  if (rating == null) {
    return 'none';
  }
  return `score${rating}`;
}
