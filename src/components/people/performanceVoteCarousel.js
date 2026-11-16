/** Matches theme spacing.sm — keep numeric for predictable FlatList layouts. */
export const PERFORMANCE_CARD_WIDTH = 96;
export const PERFORMANCE_CARD_GAP = 8;
export const PERFORMANCE_CARD_STRIDE = PERFORMANCE_CARD_WIDTH + PERFORMANCE_CARD_GAP;

export function findPerformanceActorIndex(ranked, personId) {
  if (personId == null || !Array.isArray(ranked)) {
    return -1;
  }
  return ranked.findIndex((person) => person?.personId === personId);
}

export function performanceCardLayout(index) {
  return {
    length: PERFORMANCE_CARD_WIDTH,
    offset: Math.max(0, index) * PERFORMANCE_CARD_STRIDE,
    index,
  };
}

/** Decide whether a confirmed vote should trigger an auto-scroll. */
export function shouldScrollToVotedActor({ clearing, personId, requestCurrent, requestSeq }) {
  if (clearing || personId == null) {
    return false;
  }
  if (requestCurrent !== requestSeq) {
    return false;
  }
  return true;
}
