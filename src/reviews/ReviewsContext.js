import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { useAuth } from '../auth/AuthContext';
import { useTracking } from '../tracking/TrackingContext';
import {
  deleteOwnMediaReview,
  isMediaReviewsUnavailableError,
  listOwnMediaReviews,
  upsertOwnMediaReview,
} from '../services/supabase/mediaReviews';
import { reviewPayloadFromInput } from './reviewRules';

const ReviewsContext = createContext(null);
const STORAGE_PREFIX = 'seenzo.mediaReviews.v1.';

function storageKey(scope) {
  return `${STORAGE_PREFIX}${scope || 'guest'}`;
}

async function readLocal(scope) {
  try {
    const raw = await AsyncStorage.getItem(storageKey(scope));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeLocal(scope, map) {
  try {
    await AsyncStorage.setItem(storageKey(scope), JSON.stringify(map || {}));
  } catch {
    // Ignore persistence failures; in-memory map remains usable.
  }
}

export function ReviewsProvider({ children }) {
  const { session } = useAuth();
  const { demoMode } = useTracking();
  const userId = session?.user?.id || null;
  const scope = demoMode ? `demo:${userId || 'guest'}` : (userId || 'guest');
  return (
    <ReviewsProviderBody key={scope} scope={scope} userId={userId} demoMode={demoMode}>
      {children}
    </ReviewsProviderBody>
  );
}

function ReviewsProviderBody({ children, scope, userId, demoMode }) {
  const [reviews, setReviews] = useState({});
  const [ready, setReady] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const reviewsRef = useRef(reviews);
  const scopeRef = useRef(scope);

  useEffect(() => {
    reviewsRef.current = reviews;
  }, [reviews]);

  useEffect(() => {
    let active = true;
    scopeRef.current = scope;
    (async () => {
      const local = await readLocal(scope);
      if (!active) {
        return;
      }
      setReviews(local);
      setUnavailable(false);

      if (!userId || demoMode) {
        setReady(true);
        return;
      }

      try {
        const remote = await listOwnMediaReviews();
        if (!active) {
          return;
        }
        setReviews(remote);
        await writeLocal(scope, remote);
        setUnavailable(false);
      } catch (error) {
        if (!active) {
          return;
        }
        if (isMediaReviewsUnavailableError(error)) {
          setUnavailable(true);
        }
      } finally {
        if (active) {
          setReady(true);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [demoMode, scope, userId]);

  const getReview = useCallback((mediaId) => {
    const id = String(mediaId || '');
    return reviewsRef.current?.[id] || null;
  }, []);

  const saveReview = useCallback(async (input) => {
    const payload = reviewPayloadFromInput(input);
    if (!payload) {
      const error = new Error('invalid_review');
      error.code = 'invalid_review';
      throw error;
    }

    if (payload.empty) {
      const next = { ...reviewsRef.current };
      delete next[payload.mediaId];
      setReviews(next);
      reviewsRef.current = next;
      await writeLocal(scopeRef.current, next);
      if (userId && !demoMode && !unavailable) {
        try {
          await deleteOwnMediaReview(payload.mediaId);
        } catch (error) {
          if (isMediaReviewsUnavailableError(error)) {
            setUnavailable(true);
            return null;
          }
          throw error;
        }
      }
      return null;
    }

    const localRecord = {
      id: reviewsRef.current?.[payload.mediaId]?.id || null,
      mediaType: payload.mediaType,
      mediaId: payload.mediaId,
      showMediaId: payload.showMediaId,
      seasonNumber: payload.seasonNumber,
      episodeNumber: payload.episodeNumber,
      reviewText: payload.reviewText,
      containsSpoilers: payload.containsSpoilers,
      updatedAt: new Date().toISOString(),
    };
    const next = { ...reviewsRef.current, [payload.mediaId]: localRecord };
    setReviews(next);
    reviewsRef.current = next;
    await writeLocal(scopeRef.current, next);

    if (!userId || demoMode || unavailable) {
      return localRecord;
    }
    try {
      const saved = await upsertOwnMediaReview(payload);
      if (saved) {
        const merged = { ...reviewsRef.current, [saved.mediaId]: saved };
        setReviews(merged);
        reviewsRef.current = merged;
        await writeLocal(scopeRef.current, merged);
        return saved;
      }
      return localRecord;
    } catch (error) {
      if (isMediaReviewsUnavailableError(error)) {
        setUnavailable(true);
        return localRecord;
      }
      throw error;
    }
  }, [demoMode, unavailable, userId]);

  const removeReviewById = useCallback(async (mediaId) => {
    const id = String(mediaId || '').trim();
    if (!id) {
      return null;
    }
    const next = { ...reviewsRef.current };
    delete next[id];
    setReviews(next);
    reviewsRef.current = next;
    await writeLocal(scopeRef.current, next);
    if (userId && !demoMode && !unavailable) {
      try {
        await deleteOwnMediaReview(id);
      } catch (error) {
        if (isMediaReviewsUnavailableError(error)) {
          setUnavailable(true);
          return null;
        }
        throw error;
      }
    }
    return null;
  }, [demoMode, unavailable, userId]);

  const value = useMemo(() => ({
    ready,
    unavailable,
    reviews,
    getReview,
    saveReview,
    removeReview: removeReviewById,
  }), [getReview, ready, removeReviewById, reviews, saveReview, unavailable]);

  return (
    <ReviewsContext.Provider value={value}>
      {children}
    </ReviewsContext.Provider>
  );
}

export function useReviews() {
  const value = useContext(ReviewsContext);
  if (!value) {
    throw new Error('useReviews requires ReviewsProvider');
  }
  return value;
}
