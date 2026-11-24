import { getSupabase } from './client';
import { REVIEW_MAX_LENGTH, reviewPayloadFromInput } from '../../reviews/reviewRules';

function markCoded(code, cause) {
  const error = new Error(code);
  error.code = code;
  error.cause = cause;
  return error;
}

function isUnavailable(error) {
  const text = `${error?.message || ''} ${error?.code || ''} ${error?.details || ''}`;
  return /user_media_reviews|PGRST205|PGRST204|42P01|404|schema cache/i.test(text);
}

async function requireUserId(supabase) {
  const local = await supabase.auth.getSession();
  const localId = local.data?.session?.user?.id;
  if (localId) {
    return localId;
  }
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    throw markCoded('unauthenticated', error);
  }
  return data.user.id;
}

export function normalizeMediaReviewRow(row) {
  if (!row || typeof row !== 'object') {
    return null;
  }
  const mediaId = String(row.media_id || row.mediaId || '').trim();
  const mediaType = String(row.media_type || row.mediaType || '').trim();
  const reviewText = String(row.review_text || row.reviewText || '').trim();
  if (!mediaId || !mediaType || !reviewText) {
    return null;
  }
  return {
    id: row.id || null,
    mediaType,
    mediaId,
    showMediaId: row.show_media_id || row.showMediaId || null,
    seasonNumber: row.season_number ?? row.seasonNumber ?? null,
    episodeNumber: row.episode_number ?? row.episodeNumber ?? null,
    reviewText: reviewText.slice(0, REVIEW_MAX_LENGTH),
    containsSpoilers: Boolean(row.contains_spoilers ?? row.containsSpoilers),
    updatedAt: row.updated_at || row.updatedAt || null,
  };
}

export async function listOwnMediaReviews() {
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const userId = await requireUserId(supabase);
  const { data, error } = await supabase
    .from('user_media_reviews')
    .select('id, media_type, media_id, show_media_id, season_number, episode_number, review_text, contains_spoilers, updated_at')
    .eq('user_id', userId);
  if (error) {
    if (isUnavailable(error)) {
      throw markCoded('reviews_unavailable', error);
    }
    throw markCoded('reviews_load_failed', error);
  }
  const map = {};
  (Array.isArray(data) ? data : []).forEach((row) => {
    const normalized = normalizeMediaReviewRow(row);
    if (normalized) {
      map[normalized.mediaId] = normalized;
    }
  });
  return map;
}

export async function upsertOwnMediaReview(input) {
  const payload = reviewPayloadFromInput(input);
  if (!payload) {
    throw markCoded('invalid_review');
  }
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const userId = await requireUserId(supabase);

  if (payload.empty) {
    const { error } = await supabase
      .from('user_media_reviews')
      .delete()
      .eq('user_id', userId)
      .eq('media_id', payload.mediaId);
    if (error) {
      if (isUnavailable(error)) {
        throw markCoded('reviews_unavailable', error);
      }
      throw markCoded('reviews_delete_failed', error);
    }
    return null;
  }

  const row = {
    user_id: userId,
    media_type: payload.mediaType,
    media_id: payload.mediaId,
    show_media_id: payload.showMediaId,
    season_number: payload.seasonNumber,
    episode_number: payload.episodeNumber,
    review_text: payload.reviewText,
    contains_spoilers: payload.containsSpoilers,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await supabase
    .from('user_media_reviews')
    .upsert(row, { onConflict: 'user_id,media_id' })
    .select('id, media_type, media_id, show_media_id, season_number, episode_number, review_text, contains_spoilers, updated_at')
    .maybeSingle();

  if (error) {
    if (isUnavailable(error)) {
      throw markCoded('reviews_unavailable', error);
    }
    throw markCoded('reviews_save_failed', error);
  }
  return normalizeMediaReviewRow(data);
}

export async function deleteOwnMediaReview(mediaId) {
  const id = String(mediaId || '').trim();
  if (!id) {
    return false;
  }
  const supabase = getSupabase();
  if (!supabase) {
    throw markCoded('config');
  }
  const userId = await requireUserId(supabase);
  const { error } = await supabase
    .from('user_media_reviews')
    .delete()
    .eq('user_id', userId)
    .eq('media_id', id);
  if (error) {
    if (isUnavailable(error)) {
      throw markCoded('reviews_unavailable', error);
    }
    throw markCoded('reviews_delete_failed', error);
  }
  return true;
}

export function isMediaReviewsUnavailableError(error) {
  return error?.code === 'reviews_unavailable' || isUnavailable(error);
}
