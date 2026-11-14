import { classifyChange, remoteEpisodeSignature, remoteMediaSignature } from '../../tracking/cloudState';
import { getSupabase } from './client';

const MEDIA_COLUMNS = 'media_type, media_id, show_intent, movie_saved, movie_watched, rating, updated_at';
const EPISODE_COLUMNS = 'show_media_id, episode_id, season_number, episode_number, watched, rating, watched_at, updated_at';

async function currentUserId(supabase) {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data?.user?.id) {
    const failure = new Error('auth');
    failure.code = 'auth';
    throw failure;
  }
  return data.user.id;
}

async function selectAll(supabase, table, columns, userId) {
  const pageSize = 1000;
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .eq('user_id', userId)
      .range(from, from + pageSize - 1);
    if (error) {
      throw error;
    }
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) {
      return rows;
    }
  }
}

export async function pullTracking(supabase) {
  const userId = await currentUserId(supabase);
  const [media, episodes] = await Promise.all([
    selectAll(supabase, 'media_entries', MEDIA_COLUMNS, userId),
    selectAll(supabase, 'episode_entries', EPISODE_COLUMNS, userId),
  ]);
  return { userId, media, episodes };
}

async function rowsFor(supabase, table, column, ids, userId, columns) {
  if (!ids.length) {
    return [];
  }
  const { data, error } = await supabase
    .from(table)
    .select(columns)
    .eq('user_id', userId)
    .in(column, ids);
  if (error) {
    throw error;
  }
  return data || [];
}

export async function pushTracking(supabase, expectedUserId, queue, stamps) {
  const userId = await currentUserId(supabase);
  if (userId !== expectedUserId) {
    const failure = new Error('auth');
    failure.code = 'auth';
    throw failure;
  }
  const mediaIds = Object.keys(queue.media || {});
  const episodeIds = Object.keys(queue.episodes || {});
  const [remoteMedia, remoteEpisodes] = await Promise.all([
    rowsFor(supabase, 'media_entries', 'media_id', mediaIds, userId, MEDIA_COLUMNS),
    rowsFor(supabase, 'episode_entries', 'episode_id', episodeIds, userId, EPISODE_COLUMNS),
  ]);
  const remoteMediaById = new Map(remoteMedia.map((row) => [row.media_id, row]));
  const remoteEpisodeById = new Map(remoteEpisodes.map((row) => [row.episode_id, row]));
  const mediaUpserts = [];
  const mediaDeletes = [];
  const episodeUpserts = [];
  const episodeDeletes = [];
  const acked = { media: [], episodes: [] };
  const conflicts = [];
  const nextStamps = { media: {}, episodes: {} };

  mediaIds.forEach((id) => {
    const op = queue.media[id];
    const remote = remoteMediaById.get(id) || null;
    const decision = classifyChange(
      stamps?.media?.[id] || null,
      remote?.updated_at || null,
      op.type === 'delete' ? null : op.row,
      remote ? remoteMediaSignature(remote) : null
    );
    if (decision === 'ack') {
      acked.media.push(id);
      nextStamps.media[id] = remote?.updated_at || stamps?.media?.[id] || null;
      return;
    }
    if (decision === 'conflict') {
      conflicts.push({ table: 'media_entries', id });
      return;
    }
    if (op.type === 'delete') {
      mediaDeletes.push(id);
      return;
    }
    mediaUpserts.push({ ...op.row, user_id: userId, provider: 'trakt' });
  });

  episodeIds.forEach((id) => {
    const op = queue.episodes[id];
    const remote = remoteEpisodeById.get(id) || null;
    const decision = classifyChange(
      stamps?.episodes?.[id] || null,
      remote?.updated_at || null,
      op.type === 'delete' ? null : remoteEpisodeSignature(op.row),
      remote ? remoteEpisodeSignature(remote) : null
    );
    if (decision === 'ack') {
      acked.episodes.push(id);
      nextStamps.episodes[id] = remote?.updated_at || stamps?.episodes?.[id] || null;
      return;
    }
    if (decision === 'conflict') {
      conflicts.push({ table: 'episode_entries', id });
      return;
    }
    if (op.type === 'delete') {
      episodeDeletes.push(id);
      return;
    }
    episodeUpserts.push({ ...op.row, user_id: userId });
  });

  if (mediaUpserts.length) {
    const { data, error } = await supabase
      .from('media_entries')
      .upsert(mediaUpserts, { onConflict: 'user_id,media_id' })
      .select('media_id, updated_at');
    if (error) {
      throw error;
    }
    (data || []).forEach((row) => {
      acked.media.push(row.media_id);
      nextStamps.media[row.media_id] = row.updated_at || null;
    });
  }
  if (episodeUpserts.length) {
    const { data, error } = await supabase
      .from('episode_entries')
      .upsert(episodeUpserts, { onConflict: 'user_id,episode_id' })
      .select('episode_id, updated_at, watched_at');
    if (error) {
      throw error;
    }
    (data || []).forEach((row) => {
      acked.episodes.push(row.episode_id);
      nextStamps.episodes[row.episode_id] = row.updated_at || null;
    });
  }
  if (mediaDeletes.length) {
    const { error } = await supabase.from('media_entries').delete().eq('user_id', userId).in('media_id', mediaDeletes);
    if (error) {
      throw error;
    }
    acked.media.push(...mediaDeletes);
  }
  if (episodeDeletes.length) {
    const { error } = await supabase.from('episode_entries').delete().eq('user_id', userId).in('episode_id', episodeDeletes);
    if (error) {
      throw error;
    }
    acked.episodes.push(...episodeDeletes);
  }
  return {
    userId,
    acked,
    conflicts,
    stamps: nextStamps,
    removed: { media: mediaDeletes, episodes: episodeDeletes },
  };
}

export function trackingClient() {
  return getSupabase();
}
