import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useUndoTimer } from '../../tracking/useUndoTimer';
import PosterThumb from '../../components/ui/PosterThumb';
import PrimaryButton from '../../components/ui/PrimaryButton';
import RatingSheet from '../../components/ui/RatingSheet';
import StatusBadge from '../../components/ui/StatusBadge';
import UndoBar from '../../components/tracking/UndoBar';
import { episodeTitle, mediaSynopsis, mediaTitle } from '../../data/labels';
import { rememberShow, resolveShow, useMediaRevision } from '../../data/mediaLibrary';
import { hydrateShow } from '../../services/trakt/catalog';
import { parseTraktShowKey } from '../../services/trakt/normalize';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import {
  deriveShowStatus,
  episodeCode,
  getProgress,
  isReleased,
} from '../../tracking/status';

export default function ShowDetailScreen() {
  const { id } = useLocalSearchParams();
  const showId = Array.isArray(id) ? id[0] : id;
  const revision = useMediaRevision();
  const show = resolveShow(showId);
  const traktId = parseTraktShowKey(showId);
  const [remoteLoading, setRemoteLoading] = useState(Boolean(traktId) && !show?.hydrated);
  const [remoteError, setRemoteError] = useState(null);
  const { t } = useTranslation();
  const navigation = useNavigation();
  const {
    shows,
    undo,
    toggleEpisode,
    setShowIntent,
    removeShow,
    toggleShowWatchlist,
    setShowRating,
    setEpisodeRating,
    showRatings,
    episodeRatings,
  } = useTracking();
  useUndoTimer();
  const entry = shows[showId];
  const showRating = entry?.rating ?? showRatings?.[showId] ?? null;
  const [season, setSeason] = useState(show?.seasons[0]?.season || 1);
  const [sheet, setSheet] = useState(null);
  const [draft, setDraft] = useState(null);

  useEffect(() => {
    navigation.setOptions({ title: show ? mediaTitle(t, show) : t('tv.notFound') });
  }, [navigation, revision, show, t]);

  useEffect(() => {
    if (!traktId || resolveShow(showId)?.hydrated) {
      return undefined;
    }
    let active = true;
    hydrateShow(traktId)
      .then((record) => {
        if (!active) {
          return;
        }
        if (record) {
          rememberShow(record);
        } else {
          setRemoteError({ code: 'invalid' });
        }
      })
      .catch((requestError) => {
        if (active) {
          setRemoteError(requestError);
        }
      })
      .finally(() => {
        if (active) {
          setRemoteLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [showId, traktId]);

  if (!show) {
    if (remoteLoading) {
      return (
        <View style={styles.missing}>
          <Text style={styles.body}>{t('trakt.loading')}</Text>
        </View>
      );
    }
    if (remoteError) {
      return (
        <View style={styles.missing}>
          <Text style={styles.body}>{t(`trakt.errors.${remoteError.code || 'unknown'}`, { status: remoteError.status ?? '' })}</Text>
        </View>
      );
    }
    return (
      <View style={styles.missing}>
        <Text style={styles.body}>{t('tv.notFound')}</Text>
      </View>
    );
  }

  const status = entry ? deriveShowStatus(show, entry) : null;
  const progress = getProgress(show, entry);
  const seasons = show.seasons || [];
  const seasonBlock = seasons.find((item) => item.season === season) || seasons[0];
  const watched = new Set(entry?.watchedEpisodeIds || []);

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: undo ? 120 : spacing.xl, gap: spacing.md }}>
        <View style={styles.header}>
          <PosterThumb uri={show.poster} posterPath={show.posterPath} width={96} height={144} status={status} />
          <View style={styles.headerCopy}>
            <Text style={styles.title}>{mediaTitle(t, show)}</Text>
            <Text style={styles.meta}>{show.year || t('trakt.unavailable')}</Text>
            <Text style={styles.meta}>
              {show.releaseStatus ? t(`tv.release.${show.releaseStatus}`) : t('trakt.unavailable')}
            </Text>
            <Text style={styles.meta}>
              {show.communityRating == null
                ? t('trakt.unavailable')
                : t('trakt.communityRating', { rating: show.communityRating })}
            </Text>
            <Text style={styles.meta}>{show.genres?.length ? show.genres.join(', ') : t('trakt.unavailable')}</Text>
            {status ? <StatusBadge status={status} /> : <Text style={styles.meta}>{t('tv.notTracking')}</Text>}
            <Text style={styles.meta}>
              {progress.total
                ? t('tv.progress', progress)
                : t('tv.noReleased')}
            </Text>
          </View>
        </View>
        <Text style={styles.body}>{mediaSynopsis(t, show) || t('trakt.unavailable')}</Text>
        {remoteLoading ? <Text style={styles.meta}>{t('trakt.loading')}</Text> : null}
        <Pressable
          accessibilityRole="button"
          onPress={() => {
            setDraft(showRating);
            setSheet({ type: 'show' });
          }}
          style={styles.rateRow}
        >
          <Text style={styles.episodeTitle}>{t('rating.show')}</Text>
          <Text style={styles.rateValue}>
            {showRating ? t('common.ratingValue', { rating: showRating }) : t('rating.none')}
          </Text>
        </Pressable>
        <View style={styles.actions}>
          {!entry || entry.intent === 'plan' ? (
            <PrimaryButton
              label={t(entry?.intent === 'plan' ? 'tv.removeFromWatchlist' : 'tv.addToWatchlist')}
              variant={entry?.intent === 'plan' ? 'secondary' : 'primary'}
              onPress={() => toggleShowWatchlist(show.id)}
              style={styles.action}
            />
          ) : null}
          <PrimaryButton
            label={entry?.intent === 'dropped' ? t('tv.resume') : t('tv.startWatching')}
            variant={entry?.intent === 'watching' ? 'primary' : 'secondary'}
            onPress={() => setShowIntent(show.id, 'watching')}
            style={styles.action}
          />
          <PrimaryButton
            label={t('tv.status.dropped')}
            variant={entry?.intent === 'dropped' ? 'primary' : 'secondary'}
            onPress={() => setShowIntent(show.id, 'dropped')}
            style={styles.action}
          />
        </View>
        {entry && entry.intent !== 'plan' ? (
          <PrimaryButton label={t('tv.removeShow')} variant="secondary" onPress={() => removeShow(show.id)} />
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.seasons}>
          {seasons.map((item) => {
            const selected = item.season === seasonBlock.season;
            return (
              <Pressable
                key={item.season}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setSeason(item.season)}
                style={[styles.season, selected && styles.seasonSelected]}
              >
                <Text style={[styles.seasonText, selected && styles.seasonTextSelected]}>
                  {t('tv.season', { number: item.season })}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
        {(seasonBlock?.episodes || []).map((episode) => {
          const released = isReleased(episode);
          const isWatched = watched.has(episode.id);
          const code = t('common.episodeCode', episodeCode(episode));
          const episodeRating = episodeRatings?.[episode.id] ?? null;
          return (
            <View key={episode.id} style={styles.episode}>
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: isWatched, disabled: !released }}
                disabled={!released}
                onPress={() => toggleEpisode(show.id, episode.id)}
                style={styles.episodeMain}
              >
                <Ionicons
                  name={released ? (isWatched ? 'checkmark-circle' : 'ellipse-outline') : 'lock-closed-outline'}
                  size={22}
                  color={released ? (isWatched ? colors.primary : colors.textMuted) : colors.textMuted}
                />
                <View style={styles.episodeCopy}>
                  <Text style={styles.episodeTitle}>
                    {code} · {episodeTitle(t, episode) || t('trakt.unavailable')}
                  </Text>
                  <Text style={styles.meta}>
                    {released
                      ? t('common.minutes', { count: episode.runtime })
                      : episode.airDate
                      ? t('tv.upcoming', { date: formatAirDate(episode.airDate) })
                      : t('upcoming.tba')}
                  </Text>
                </View>
              </Pressable>
              {released ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={t('rating.episode')}
                  onPress={() => {
                    setDraft(episodeRating);
                    setSheet({ type: 'episode', id: episode.id, title: `${code} · ${episodeTitle(t, episode)}` });
                  }}
                  style={styles.rateChip}
                >
                  <Text style={styles.rateValue}>
                    {episodeRating ? t('common.ratingValue', { rating: episodeRating }) : t('rating.rate')}
                  </Text>
                </Pressable>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.note}>{t('tv.unreleasedNote')}</Text>
      </ScrollView>
      <UndoBar bottom={16} />
      <RatingSheet
        visible={Boolean(sheet)}
        title={sheet?.type === 'episode' ? sheet.title : t('rating.show')}
        value={draft}
        savedValue={sheet?.type === 'episode' ? episodeRatings?.[sheet.id] ?? null : showRating}
        onChange={setDraft}
        onClose={() => setSheet(null)}
        onSave={() => {
          if (draft == null || !sheet) {
            return;
          }
          if (sheet.type === 'episode') {
            setEpisodeRating(sheet.id, draft);
          } else {
            setShowRating(show.id, draft);
          }
          setSheet(null);
        }}
        onRemove={() => {
          if (!sheet) {
            return;
          }
          if (sheet.type === 'episode') {
            setEpisodeRating(sheet.id, null);
          } else {
            setShowRating(show.id, null);
          }
          setSheet(null);
        }}
      />
    </View>
  );
}

function formatAirDate(iso) {
  const [year, month, day] = iso.split('-').map(Number);
  return new Date(year, month - 1, day).toLocaleDateString();
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  missing: {
    flex: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
  },
  header: {
    flexDirection: 'row',
    gap: spacing.md,
  },
  headerCopy: {
    flex: 1,
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  action: {
    flexGrow: 1,
  },
  seasons: {
    gap: spacing.sm,
  },
  season: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
  },
  seasonSelected: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  seasonText: {
    ...typography.label,
    color: colors.text,
  },
  seasonTextSelected: {
    color: colors.onPrimary,
  },
  rateRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: 52,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rateValue: {
    ...typography.body,
    color: colors.primary,
    fontWeight: '700',
  },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
  },
  episodeMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  rateChip: {
    minWidth: 64,
    minHeight: 40,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  episodeCopy: {
    flex: 1,
    gap: 2,
  },
  episodeTitle: {
    ...typography.body,
    color: colors.text,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
