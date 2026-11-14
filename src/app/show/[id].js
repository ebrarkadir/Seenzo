import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { useUndoTimer } from '../../tracking/useUndoTimer';
import PosterThumb from '../../components/ui/PosterThumb';
import RatingSheet from '../../components/ui/RatingSheet';
import StatusBadge from '../../components/ui/StatusBadge';
import UndoBar from '../../components/tracking/UndoBar';
import EpisodeDetailSheet from '../../components/tracking/EpisodeDetailSheet';
import ShowOverflowMenu from '../../components/tracking/ShowOverflowMenu';
import CastCrewSection from '../../components/people/CastCrewSection';
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
  getSeasonProgress,
  isReleased,
  listEpisodes,
  listShowSeasons,
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
    setSeasonWatched,
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
  const [expanded, setExpanded] = useState({});
  const [menuOpen, setMenuOpen] = useState(false);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState(null);
  const [ratingTarget, setRatingTarget] = useState(null);
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

  const seasons = useMemo(() => {
    if (revision < 0 || !show) {
      return [];
    }
    return listShowSeasons(show);
  }, [revision, show]);
  const episodesBySeason = useMemo(() => {
    const map = {};
    if (revision < 0 || !show) {
      return map;
    }
    listEpisodes(show).forEach((episode) => {
      if (!map[episode.season]) {
        map[episode.season] = [];
      }
      map[episode.season].push(episode);
    });
    return map;
  }, [revision, show]);

  const selectedEpisode = useMemo(() => {
    if (revision < 0 || !selectedEpisodeId || !show) {
      return null;
    }
    return listEpisodes(show).find((episode) => episode.id === selectedEpisodeId) || null;
  }, [revision, selectedEpisodeId, show]);

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
  const watched = new Set(entry?.watchedEpisodeIds || []);
  const overflowOptions = [];
  if (!entry) {
    overflowOptions.push({
      key: 'watchlist-add',
      label: t('tv.addToWatchlist'),
      onPress: () => toggleShowWatchlist(show.id),
    });
  } else if (entry.intent === 'plan') {
    overflowOptions.push({
      key: 'watchlist-remove',
      label: t('tv.removeFromWatchlist'),
      onPress: () => toggleShowWatchlist(show.id),
    });
  }
  if (entry?.intent === 'dropped') {
    overflowOptions.push({
      key: 'resume',
      label: t('tv.resume'),
      onPress: () => setShowIntent(show.id, 'watching'),
    });
  } else if (entry) {
    overflowOptions.push({
      key: 'drop',
      label: t('tv.dropShow'),
      onPress: () => setShowIntent(show.id, 'dropped'),
    });
  }
  if (entry && entry.intent !== 'plan') {
    overflowOptions.push({
      key: 'remove',
      label: t('tv.removeShow'),
      destructive: true,
      onPress: () => {
        Alert.alert(t('tv.removeShowTitle'), t('tv.removeShowMessage'), [
          { text: t('common.cancel'), style: 'cancel' },
          { text: t('common.remove'), style: 'destructive', onPress: () => removeShow(show.id) },
        ]);
      },
    });
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ padding: spacing.md, paddingBottom: undo ? 120 : spacing.xl, gap: spacing.md }}>
        <View style={styles.header}>
          <PosterThumb uri={show.poster} posterPath={show.posterPath} width={96} height={144} status={status} />
          <View style={styles.headerCopy}>
            <View style={styles.titleRow}>
              <Text style={styles.title}>{mediaTitle(t, show)}</Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={t('tv.moreActions')}
                onPress={() => setMenuOpen(true)}
                hitSlop={8}
                style={styles.moreButton}
              >
                <Ionicons name="ellipsis-vertical" size={20} color={colors.text} />
              </Pressable>
            </View>
            <Text style={styles.meta}>{show.year || t('trakt.unavailable')}</Text>
            <Text style={styles.meta}>
              {show.releaseStatus ? t(`tv.release.${show.releaseStatus}`) : t('trakt.unavailable')}
            </Text>
            <Text style={styles.meta}>
              {show.communityRating == null
                ? t('trakt.unavailable')
                : t('trakt.communityRating', { rating: show.communityRating })}
            </Text>
            {status ? <StatusBadge status={status} /> : <Text style={styles.meta}>{t('tv.notTracking')}</Text>}
            <Text style={styles.meta}>
              {progress.total ? t('tv.progress', progress) : t('tv.noReleased')}
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('rating.show')}
              onPress={() => {
                setDraft(showRating);
                setRatingTarget({ type: 'show' });
              }}
              style={styles.rateChip}
            >
              <Ionicons name="star-outline" size={16} color={colors.primary} />
              <Text style={styles.rateValue}>
                {showRating != null ? t('common.ratingValue', { rating: showRating }) : t('rating.rate')}
              </Text>
            </Pressable>
          </View>
        </View>
        <Text style={styles.body}>{mediaSynopsis(t, show) || t('trakt.unavailable')}</Text>
        {remoteLoading ? <Text style={styles.meta}>{t('trakt.loading')}</Text> : null}
        {traktId ? (
          <View style={styles.peopleBlock}>
            <Text style={styles.peopleHeading}>{t('people.showCastCrew')}</Text>
            <CastCrewSection mode="show" traktShowId={traktId} />
          </View>
        ) : (
          <Text style={styles.meta}>{t('people.unavailableForDemo')}</Text>
        )}
        {seasons.map((seasonNumber) => {
          const open = Boolean(expanded[seasonNumber]);
          const seasonProgress = getSeasonProgress(show, entry, seasonNumber);
          const label = seasonNumber === 0 ? t('tv.seasonSpecials') : t('tv.season', { number: seasonNumber });
          const ratio = seasonProgress.total > 0 ? seasonProgress.watched / seasonProgress.total : 0;
          const allWatched = seasonProgress.total > 0 && seasonProgress.watched === seasonProgress.total;
          return (
            <View key={seasonNumber} style={styles.seasonCard}>
              <View style={styles.seasonHeader}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: open }}
                  accessibilityLabel={t(open ? 'tv.collapseSeason' : 'tv.expandSeason', { season: label })}
                  onPress={() => setExpanded((current) => ({ ...current, [seasonNumber]: !current[seasonNumber] }))}
                  style={styles.seasonToggle}
                >
                  <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textSecondary} />
                  <View style={styles.seasonCopy}>
                    <Text style={styles.seasonTitle}>{label}</Text>
                    <Text style={styles.meta}>
                      {seasonProgress.total
                        ? t('tv.seasonProgress', seasonProgress)
                        : t('tv.noReleased')}
                    </Text>
                    {seasonProgress.total ? (
                      <View style={styles.track}>
                        <View style={[styles.fill, { width: `${Math.round(ratio * 100)}%` }]} />
                      </View>
                    ) : null}
                  </View>
                </Pressable>
                {seasonProgress.total ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t(allWatched ? 'tv.markSeasonUnwatched' : 'tv.markAll')}
                    onPress={() => setSeasonWatched(show.id, seasonNumber, !allWatched)}
                    hitSlop={6}
                    style={[styles.markAll, allWatched && styles.markAllDone]}
                  >
                    <Ionicons
                      name={allWatched ? 'checkmark-circle' : 'checkmark'}
                      size={16}
                      color={allWatched ? colors.onPrimary : colors.primary}
                    />
                    <Text style={[styles.markAllText, allWatched && styles.markAllTextDone]}>
                      {allWatched ? t('tv.markAllDone') : t('tv.markAll')}
                    </Text>
                  </Pressable>
                ) : null}
              </View>
              {open ? (
                <View style={styles.seasonBody}>
                  {(episodesBySeason[seasonNumber] || []).map((episode) => {
                    const released = isReleased(episode);
                    const isWatched = released && watched.has(episode.id);
                    const code = t('common.episodeCode', episodeCode(episode));
                    const episodeRating = episodeRatings?.[episode.id] ?? null;
                    return (
                      <Pressable
                        key={episode.id}
                        accessibilityRole="button"
                        accessibilityLabel={t('tv.openEpisode', {
                          code,
                          title: episodeTitle(t, episode) || t('trakt.unavailable'),
                        })}
                        onPress={() => setSelectedEpisodeId(episode.id)}
                        style={styles.episode}
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
                              ? [
                                episode.airDate ? t('tv.airedOn', { date: formatAirDate(episode.airDate) }) : null,
                                typeof episode.runtime === 'number' ? t('common.minutes', { count: episode.runtime }) : null,
                                episodeRating != null ? t('common.ratingValue', { rating: episodeRating }) : null,
                              ].filter(Boolean).join(' · ') || t('trakt.unavailable')
                              : episode.airDate
                                ? t('tv.upcoming', { date: formatAirDate(episode.airDate) })
                                : t('upcoming.tba')}
                          </Text>
                        </View>
                        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                      </Pressable>
                    );
                  })}
                </View>
              ) : null}
            </View>
          );
        })}
        <Text style={styles.note}>{t('tv.unreleasedNote')}</Text>
      </ScrollView>
      <UndoBar bottom={16} />
      <ShowOverflowMenu
        visible={menuOpen}
        options={overflowOptions}
        onClose={() => setMenuOpen(false)}
      />
      <EpisodeDetailSheet
        visible={Boolean(selectedEpisode)}
        show={show}
        episode={selectedEpisode}
        watched={selectedEpisode ? watched.has(selectedEpisode.id) : false}
        rating={selectedEpisode ? episodeRatings?.[selectedEpisode.id] ?? null : null}
        onClose={() => setSelectedEpisodeId(null)}
        onToggleWatched={() => {
          if (selectedEpisode) {
            toggleEpisode(show.id, selectedEpisode.id);
          }
        }}
        onRate={() => {
          if (!selectedEpisode) {
            return;
          }
          setDraft(episodeRatings?.[selectedEpisode.id] ?? null);
          setRatingTarget({ type: 'episode', id: selectedEpisode.id, title: `${t('common.episodeCode', episodeCode(selectedEpisode))} · ${episodeTitle(t, selectedEpisode)}` });
        }}
      />
      <RatingSheet
        visible={Boolean(ratingTarget)}
        title={ratingTarget?.type === 'episode' ? ratingTarget.title : t('rating.show')}
        value={draft}
        savedValue={
          ratingTarget?.type === 'episode'
            ? episodeRatings?.[ratingTarget.id] ?? null
            : showRating
        }
        onChange={setDraft}
        onClose={() => setRatingTarget(null)}
        onSave={() => {
          if (draft == null || !ratingTarget) {
            return;
          }
          if (ratingTarget.type === 'episode') {
            setEpisodeRating(ratingTarget.id, draft);
          } else {
            setShowRating(show.id, draft);
          }
          setRatingTarget(null);
        }}
        onRemove={() => {
          if (!ratingTarget) {
            return;
          }
          if (ratingTarget.type === 'episode') {
            setEpisodeRating(ratingTarget.id, null);
          } else {
            setShowRating(show.id, null);
          }
          setRatingTarget(null);
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
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.sm,
  },
  title: {
    ...typography.title,
    color: colors.text,
    flex: 1,
  },
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  body: {
    ...typography.body,
    color: colors.textSecondary,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rateChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  rateValue: {
    ...typography.label,
    color: colors.primary,
  },
  seasonCard: {
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  seasonHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.sm,
    paddingRight: spacing.sm,
  },
  seasonToggle: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  seasonCopy: {
    flex: 1,
    gap: 6,
  },
  seasonTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  markAll: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: 36,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.primary,
    backgroundColor: 'transparent',
  },
  markAllDone: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  markAllText: {
    ...typography.label,
    color: colors.primary,
  },
  markAllTextDone: {
    color: colors.onPrimary,
  },
  track: {
    height: 3,
    borderRadius: radii.full,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: colors.primary,
  },
  seasonBody: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  episode: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
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
  peopleBlock: {
    gap: spacing.sm,
  },
  peopleHeading: {
    ...typography.subtitle,
    color: colors.text,
  },
});
