import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams, useNavigation } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import PosterTile from '../../components/media/PosterTile';
import EmptyState from '../../components/ui/EmptyState';
import { mediaGenreLine } from '../../data/labels';
import { rememberMovie, rememberShow, resolveMovie, resolveShow } from '../../data/mediaLibrary';
import { useProfile } from '../../profile/ProfileContext';
import {
  recommendationMoviePool,
  recommendationShowPool,
} from '../../services/trakt/catalog';
import { getTraktConfigStatus } from '../../services/trakt/config';
import { colors, spacing, typography } from '../../theme';
import {
  DISCOVER_RECOMMEND_SEE_ALL_LIMIT,
  buildDiscoverRecommendations,
  discoverPreferenceMessage,
} from '../../tracking/discoverRecommendations';
import {
  PREFERENCE_CONFIDENCE_HISTORY,
  buildPreferenceProfile,
} from '../../tracking/preferenceProfile';
import { useTracking } from '../../tracking/TrackingContext';
import {
  isMovieWatchlisted,
  isShowWatchlisted,
  movieBookmarkVisible,
  showBookmarkVisible,
} from '../../tracking/watchlist';

function formatCommunityRating(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Number(value.toFixed(1));
}

const SEE_ALL_POOL = { trendingPages: 3, popularPages: 3 };

export default function DiscoverRecommendationsScreen() {
  const { t } = useTranslation();
  const navigation = useNavigation();
  const params = useLocalSearchParams();
  const rawType = Array.isArray(params.type) ? params.type[0] : params.type;
  const mediaKind = rawType === 'show' || rawType === 'tv' ? 'show' : 'movie';
  const config = getTraktConfigStatus();
  const {
    shows: trackedShows,
    movies: trackedMovies,
    showRatings,
    toggleShowWatchlist,
    toggleMovieWatchlist,
  } = useTracking();
  const { favorites } = useProfile();
  const [pool, setPool] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  // Keep loading true until the first pool response for this media kind.

  const title = mediaKind === 'show'
    ? t('discover.recommendedShows')
    : t('discover.recommendedMovies');

  useLayoutEffect(() => {
    navigation.setOptions({ title });
  }, [navigation, title]);

  const favoriteIds = useMemo(() => {
    const list = mediaKind === 'show' ? favorites?.shows : favorites?.movies;
    return (list || []).map((item) => item.mediaId).filter(Boolean);
  }, [favorites, mediaKind]);

  const profile = useMemo(() => {
    if (mediaKind === 'show') {
      return buildPreferenceProfile(
        { shows: trackedShows, showRatings },
        {
          mediaKind: 'show',
          resolveShow,
          favoriteShowIds: favoriteIds,
        }
      );
    }
    return buildPreferenceProfile(
      { movies: trackedMovies },
      {
        mediaKind: 'movie',
        resolveMovie,
        favoriteMovieIds: favoriteIds,
      }
    );
  }, [favoriteIds, mediaKind, showRatings, trackedMovies, trackedShows]);

  const poolKey = profile.ready
    ? `${mediaKind}:${(profile.topRatedSeeds || []).map((seed) => seed.traktId).join(',')}:${(profile.topPositiveGenres || []).join(',')}`
    : `${mediaKind}:base`;

  useEffect(() => {
    if (!config.ready) {
      return undefined;
    }
    let active = true;
    const task = mediaKind === 'show'
      ? recommendationShowPool({
        ...SEE_ALL_POOL,
        profile: profile.ready ? profile : null,
      })
      : recommendationMoviePool({
        ...SEE_ALL_POOL,
        profile: profile.ready ? profile : null,
      });
    task
      .then((items) => {
        if (!active) {
          return;
        }
        setPool(items);
        setError(null);
        items.forEach((item) => {
          if (mediaKind === 'show') {
            rememberShow(item);
          } else {
            rememberMovie(item);
          }
        });
      })
      .catch((requestError) => {
        if (active) {
          setError(requestError);
          setPool([]);
        }
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
    // poolKey captures seed/genre expansion; profile object identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.ready, mediaKind, poolKey]);

  const recommendations = useMemo(
    () => buildDiscoverRecommendations(pool, {
      profile,
      mediaKind,
      moviesState: trackedMovies,
      showsState: trackedShows,
      resolveShow,
      limit: DISCOVER_RECOMMEND_SEE_ALL_LIMIT,
      t,
    }),
    [mediaKind, pool, profile, t, trackedMovies, trackedShows]
  );

  const openRow = (row) => {
    const item = row.media || row.item;
    if (mediaKind === 'show') {
      rememberShow(item);
      router.push(`/show/${row.id}`);
      return;
    }
    rememberMovie(item);
    router.push(`/movie/${row.id}`);
  };

  const bookmarkRow = (row) => {
    const item = row.media || row.item;
    if (mediaKind === 'show') {
      rememberShow(item);
      toggleShowWatchlist(row.id);
      return;
    }
    rememberMovie(item);
    toggleMovieWatchlist(row.id);
  };

  if (!config.ready) {
    return (
      <View style={styles.screen}>
        <EmptyState title={t('discover.unavailableTitle')} body={t(`trakt.errors.${config.reason}`)} />
      </View>
    );
  }

  if (!loading && !profile.ready) {
    return (
      <View style={styles.screen}>
        <EmptyState
          title={title}
          body={discoverPreferenceMessage(t, profile)
            || (mediaKind === 'show' ? t('discover.rateShowsToUnlock') : t('discover.rateMoviesToUnlock'))}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <PosterGrid
        data={recommendations.items}
        keyExtractor={(row) => row.id}
        contentBottom={spacing.xl}
        ListHeaderComponent={
          loading || error || profile.confidence === PREFERENCE_CONFIDENCE_HISTORY ? (
            <View style={styles.headerBlock}>
              {loading ? <ActivityIndicator color={colors.primary} /> : null}
              {!loading && profile.confidence === PREFERENCE_CONFIDENCE_HISTORY ? (
                <Text style={styles.historyNote}>{t('discover.basedOnWatchingHistory')}</Text>
              ) : null}
              {error ? (
                <Text style={styles.error}>
                  {t(`trakt.errors.${error.code}`, {
                    status: error.status ?? '',
                    seconds: error.retryAfter ?? '',
                  })}
                </Text>
              ) : null}
            </View>
          ) : null
        }
        ListEmptyComponent={
          loading ? null : (
            <EmptyState title={t('discover.noRecommendations')} body={t('discover.emptyBody')} />
          )
        }
        renderItem={(row, size) => {
          const entry = mediaKind === 'show' ? trackedShows[row.id] : trackedMovies[row.id];
          const tracked = mediaKind === 'show' ? Boolean(entry) : Boolean(entry?.saved);
          const watchlisted = mediaKind === 'show'
            ? isShowWatchlisted(entry)
            : isMovieWatchlisted(entry);
          const bookmark = mediaKind === 'show'
            ? showBookmarkVisible(entry)
            : movieBookmarkVisible(entry);
          const genreLine = row.genreLine || mediaGenreLine(t, row.media, { limit: 2 });
          const rating = formatCommunityRating(row.media?.communityRating);
          const meta = [
            row.media?.year,
            genreLine,
            rating != null ? t('trakt.communityRating', { rating }) : null,
          ].filter(Boolean).join(' · ');
          return (
            <PosterTile
              posterPath={row.media?.posterPath}
              uri={row.media?.poster}
              title={row.media?.title || ''}
              meta={meta || null}
              detail={row.reason || null}
              width={size.width}
              height={size.height}
              badge={tracked ? t('discover.inLibrary') : null}
              watchlisted={watchlisted}
              bookmarkLabel={t(
                watchlisted ? 'watchlist.remove' : 'watchlist.add',
                { title: row.media?.title || '' }
              )}
              onBookmark={bookmark ? () => bookmarkRow(row) : null}
              onPress={() => openRow(row)}
            />
          );
        }}
      />
    </View>
  );
}

const styles = {
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  headerBlock: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
    gap: spacing.sm,
  },
  historyNote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  error: {
    ...typography.caption,
    color: colors.favorite,
  },
};
