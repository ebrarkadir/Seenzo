import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import DiscoverRecommendRail, {
  DiscoverBrowseHeading,
  DiscoverSectionDivider,
} from '../../components/discover/DiscoverRecommendRail';
import PosterGrid from '../../components/media/PosterGrid';
import PosterTile from '../../components/media/PosterTile';
import EmptyState from '../../components/ui/EmptyState';
import SearchField from '../../components/ui/SearchField';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { mediaGenreLine } from '../../data/labels';
import { rememberMovie, rememberShow, resolveMovie, resolveShow } from '../../data/mediaLibrary';
import { useProfile } from '../../profile/ProfileContext';
import {
  recommendationMoviePool,
  recommendationShowPool,
  searchMoviesPage,
  searchShowsPage,
  trendingMoviesPage,
  trendingShowsPage,
} from '../../services/trakt/catalog';
import { getTraktConfigStatus } from '../../services/trakt/config';
import { mergeCatalogPage } from '../../services/trakt/normalize';
import { colors, spacing, typography } from '../../theme';
import {
  DISCOVER_RECOMMEND_RAIL_LIMIT,
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

const RAIL_POOL = { trendingPages: 2, popularPages: 2 };

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const routeType = params.type === 'movie' || params.type === 'tv' ? params.type : 'tv';
  const [manualFilter, setManualFilter] = useState(null);
  const filter = manualFilter && manualFilter.routeType === routeType ? manualFilter.value : routeType;
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [items, setItems] = useState([]);
  const [page, setPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [moviePool, setMoviePool] = useState([]);
  const [showPool, setShowPool] = useState([]);
  const [moviePoolLoading, setMoviePoolLoading] = useState(routeType === 'movie');
  const [showPoolLoading, setShowPoolLoading] = useState(routeType !== 'movie');
  const [moviePoolError, setMoviePoolError] = useState(null);
  const [showPoolError, setShowPoolError] = useState(null);
  const requestId = useRef(0);
  const timer = useRef(null);
  const moviePoolKeyRef = useRef('');
  const showPoolKeyRef = useRef('');
  const config = getTraktConfigStatus();
  const {
    shows: trackedShows,
    movies: trackedMovies,
    showRatings,
    toggleShowWatchlist,
    toggleMovieWatchlist,
  } = useTracking();
  const { favorites } = useProfile();
  const searching = debounced.length >= 2;
  const isMovieFilter = filter === 'movie';

  const favoriteMovieIds = useMemo(
    () => (favorites?.movies || []).map((item) => item.mediaId).filter(Boolean),
    [favorites]
  );
  const favoriteShowIds = useMemo(
    () => (favorites?.shows || []).map((item) => item.mediaId).filter(Boolean),
    [favorites]
  );

  const movieProfile = useMemo(
    () => buildPreferenceProfile(
      { movies: trackedMovies },
      {
        mediaKind: 'movie',
        resolveMovie,
        favoriteMovieIds,
      }
    ),
    [trackedMovies, favoriteMovieIds]
  );

  const showProfile = useMemo(
    () => buildPreferenceProfile(
      { shows: trackedShows, showRatings },
      {
        mediaKind: 'show',
        resolveShow,
        favoriteShowIds,
      }
    ),
    [favoriteShowIds, showRatings, trackedShows]
  );

  const movieRecommendations = useMemo(
    () => buildDiscoverRecommendations(moviePool, {
      profile: movieProfile,
      mediaKind: 'movie',
      moviesState: trackedMovies,
      limit: DISCOVER_RECOMMEND_RAIL_LIMIT,
      t,
    }),
    [moviePool, movieProfile, t, trackedMovies]
  );

  const showRecommendations = useMemo(
    () => buildDiscoverRecommendations(showPool, {
      profile: showProfile,
      mediaKind: 'show',
      showsState: trackedShows,
      resolveShow,
      limit: DISCOVER_RECOMMEND_RAIL_LIMIT,
      t,
    }),
    [showPool, showProfile, t, trackedShows]
  );

  const onQuery = (text) => {
    setQuery(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      setDebounced(text.trim());
    }, 400);
  };

  const moviePoolKey = movieProfile.ready
    ? `m:${(movieProfile.topRatedSeeds || []).map((seed) => seed.traktId).join(',')}:${(movieProfile.topPositiveGenres || []).join(',')}`
    : 'm:base';
  const showPoolKey = showProfile.ready
    ? `s:${(showProfile.topRatedSeeds || []).map((seed) => seed.traktId).join(',')}:${(showProfile.topPositiveGenres || []).join(',')}`
    : 's:base';

  useEffect(() => {
    if (!config.ready || searching) {
      return undefined;
    }
    let active = true;
    if (isMovieFilter) {
      if (moviePoolKeyRef.current === moviePoolKey) {
        return undefined;
      }
      moviePoolKeyRef.current = moviePoolKey;
      recommendationMoviePool({
        ...RAIL_POOL,
        profile: movieProfile.ready ? movieProfile : null,
      })
        .then((movies) => {
          if (!active) {
            return;
          }
          setMoviePool(movies);
          setMoviePoolError(null);
          movies.forEach((item) => rememberMovie(item));
        })
        .catch((requestError) => {
          if (active) {
            setMoviePoolError(requestError);
            setMoviePool([]);
          }
        })
        .finally(() => {
          if (active) {
            setMoviePoolLoading(false);
          }
        });
    } else {
      if (showPoolKeyRef.current === showPoolKey) {
        return undefined;
      }
      showPoolKeyRef.current = showPoolKey;
      recommendationShowPool({
        ...RAIL_POOL,
        profile: showProfile.ready ? showProfile : null,
      })
        .then((shows) => {
          if (!active) {
            return;
          }
          setShowPool(shows);
          setShowPoolError(null);
          shows.forEach((item) => rememberShow(item));
        })
        .catch((requestError) => {
          if (active) {
            setShowPoolError(requestError);
            setShowPool([]);
          }
        })
        .finally(() => {
          if (active) {
            setShowPoolLoading(false);
          }
        });
    }
    return () => {
      active = false;
    };
  }, [config.ready, isMovieFilter, moviePoolKey, movieProfile, searching, showPoolKey, showProfile]);

  useEffect(() => {
    if (!config.ready) {
      return undefined;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    let active = true;
    const searchText = searching ? debounced : '';
    const task = searchText
      ? filter === 'tv'
        ? searchShowsPage(searchText, 1)
        : searchMoviesPage(searchText, 1)
      : filter === 'tv'
        ? trendingShowsPage(1)
        : trendingMoviesPage(1);
    task
      .then((result) => {
        if (!active || requestId.current !== current) {
          return;
        }
        setItems(result.items);
        setPage(result.page);
        setPageCount(result.pageCount);
        setError(null);
      })
      .catch((requestError) => {
        if (!active || requestId.current !== current) {
          return;
        }
        setItems([]);
        setError(requestError);
      })
      .finally(() => {
        if (active && requestId.current === current) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [config.ready, debounced, filter, searching]);

  const loadMore = () => {
    if (!config.ready || loading || page >= pageCount) {
      return;
    }
    const nextPage = page + 1;
    const searchText = searching ? debounced : '';
    const task = searchText
      ? filter === 'tv'
        ? searchShowsPage(searchText, nextPage)
        : searchMoviesPage(searchText, nextPage)
      : filter === 'tv'
        ? trendingShowsPage(nextPage)
        : trendingMoviesPage(nextPage);
    setLoading(true);
    task
      .then((result) => {
        setItems((current) => mergeCatalogPage(current, result.items));
        setPage(result.page);
        setPageCount(result.pageCount);
        setError(null);
      })
      .catch((requestError) => setError(requestError))
      .finally(() => setLoading(false));
  };

  const openItem = (item) => {
    if (filter === 'tv') {
      rememberShow(item);
      router.push(`/show/${item.id}`);
      return;
    }
    rememberMovie(item);
    router.push(`/movie/${item.id}`);
  };

  const bookmarkItem = (item) => {
    if (filter === 'tv') {
      rememberShow(item);
      toggleShowWatchlist(item.id);
      return;
    }
    rememberMovie(item);
    toggleMovieWatchlist(item.id);
  };

  const openRecommended = (row) => {
    const item = row.media || row.item;
    if (String(row.id || '').startsWith('trakt-show-')) {
      rememberShow(item);
      router.push(`/show/${row.id}`);
      return;
    }
    rememberMovie(item);
    router.push(`/movie/${row.id}`);
  };

  const bookmarkRecommended = (row) => {
    const item = row.media || row.item;
    if (String(row.id || '').startsWith('trakt-show-')) {
      rememberShow(item);
      toggleShowWatchlist(row.id);
      return;
    }
    rememberMovie(item);
    toggleMovieWatchlist(row.id);
  };

  const openSeeAll = (type) => {
    router.push({
      pathname: '/discover/recommendations',
      params: { type },
    });
  };

  const poolLoading = isMovieFilter ? moviePoolLoading : showPoolLoading;
  const poolError = isMovieFilter ? moviePoolError : showPoolError;
  const activeProfile = isMovieFilter ? movieProfile : showProfile;
  const activeRecommendations = isMovieFilter ? movieRecommendations : showRecommendations;
  const canSeeAll = !searching
    && !poolLoading
    && activeProfile.ready
    && activeRecommendations.items.length > 0;

  const header = (
    <View>
      <SearchField value={query} onChangeText={onQuery} placeholder={t('discover.search')} />
      <SegmentedControl
        value={filter}
        onChange={(value) => {
          setLoading(true);
          setItems([]);
          setManualFilter({ routeType, value });
          if (value === 'movie' && moviePoolKeyRef.current !== moviePoolKey) {
            setMoviePoolLoading(true);
          }
          if (value === 'tv' && showPoolKeyRef.current !== showPoolKey) {
            setShowPoolLoading(true);
          }
        }}
        options={[
          { value: 'tv', label: t('discover.shows') },
          { value: 'movie', label: t('discover.movies') },
        ]}
      />
      {!searching ? (
        <View>
          {isMovieFilter ? (
            <DiscoverRecommendRail
              title={t('discover.recommendedMovies')}
              loading={moviePoolLoading}
              subtitle={
                !moviePoolLoading
                && movieProfile.ready
                && movieProfile.confidence === PREFERENCE_CONFIDENCE_HISTORY
                  ? t('discover.basedOnWatchingHistory')
                  : null
              }
              coldStartMessage={
                !moviePoolLoading && !movieProfile.ready
                  ? discoverPreferenceMessage(t, movieProfile)
                  : null
              }
              emptyMessage={
                movieProfile.ready && !movieRecommendations.items.length
                  ? t('discover.noRecommendations')
                  : null
              }
              items={movieRecommendations.items}
              showSeeAll={canSeeAll}
              onSeeAll={() => openSeeAll('movie')}
              getWatchState={(row) => {
                const entry = trackedMovies[row.id];
                return {
                  tracked: Boolean(entry?.saved),
                  watchlisted: isMovieWatchlisted(entry),
                  bookmark: movieBookmarkVisible(entry),
                };
              }}
              onOpen={openRecommended}
              onBookmark={bookmarkRecommended}
            />
          ) : (
            <DiscoverRecommendRail
              title={t('discover.recommendedShows')}
              loading={showPoolLoading}
              subtitle={
                !showPoolLoading
                && showProfile.ready
                && showProfile.confidence === PREFERENCE_CONFIDENCE_HISTORY
                  ? t('discover.basedOnWatchingHistory')
                  : null
              }
              coldStartMessage={
                !showPoolLoading && !showProfile.ready
                  ? discoverPreferenceMessage(t, showProfile)
                  : null
              }
              emptyMessage={
                showProfile.ready && !showRecommendations.items.length
                  ? t('discover.noRecommendations')
                  : null
              }
              items={showRecommendations.items}
              showSeeAll={canSeeAll}
              onSeeAll={() => openSeeAll('show')}
              getWatchState={(row) => {
                const entry = trackedShows[row.id];
                return {
                  tracked: Boolean(entry),
                  watchlisted: isShowWatchlisted(entry),
                  bookmark: showBookmarkVisible(entry),
                };
              }}
              onOpen={openRecommended}
              onBookmark={bookmarkRecommended}
            />
          )}
          {poolError ? (
            <Text style={errorStyle}>
              {t(`trakt.errors.${poolError.code}`, {
                status: poolError.status ?? '',
                seconds: poolError.retryAfter ?? '',
              })}
            </Text>
          ) : null}
          <DiscoverSectionDivider />
          <DiscoverBrowseHeading label={t('discover.trendingNow')} />
        </View>
      ) : null}
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginBottom: spacing.sm }} /> : null}
      {error ? (
        <Text style={errorStyle}>
          {t(`trakt.errors.${error.code}`, { status: error.status ?? '', seconds: error.retryAfter ?? '' })}
        </Text>
      ) : null}
    </View>
  );

  if (!config.ready) {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <EmptyState title={t('discover.unavailableTitle')} body={t(`trakt.errors.${config.reason}`)} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PosterGrid
        data={items}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentBottom={spacing.lg}
        onEndReached={loadMore}
        ListEmptyComponent={
          loading ? null : <EmptyState title={t('discover.empty')} body={t('discover.emptyBody')} />
        }
        ListFooterComponent={
          page < pageCount ? (
            <Text style={footerStyle} onPress={loadMore}>
              {t('discover.loadMore')}
            </Text>
          ) : null
        }
        renderItem={(item, size) => {
          const entry = filter === 'tv' ? trackedShows[item.id] : trackedMovies[item.id];
          const tracked = filter === 'tv' ? Boolean(entry) : Boolean(entry?.saved);
          const watchlisted = filter === 'tv' ? isShowWatchlisted(entry) : isMovieWatchlisted(entry);
          const bookmark = filter === 'tv' ? showBookmarkVisible(entry) : movieBookmarkVisible(entry);
          const genreLine = mediaGenreLine(t, item, { limit: 2 });
          const meta = [item.year, genreLine].filter(Boolean).join(' · ');
          return (
            <PosterTile
              posterPath={item.posterPath}
              title={item.title}
              meta={meta || null}
              badge={tracked ? t('discover.inLibrary') : null}
              watchlisted={watchlisted}
              bookmarkLabel={t(watchlisted ? 'watchlist.remove' : 'watchlist.add', { title: item.title })}
              onBookmark={bookmark ? () => bookmarkItem(item) : null}
              width={size.width}
              height={size.height}
              onPress={() => openItem(item)}
            />
          );
        }}
      />
    </View>
  );
}

const errorStyle = {
  ...typography.caption,
  color: colors.favorite,
  marginHorizontal: spacing.md,
  marginBottom: spacing.sm,
};

const footerStyle = {
  ...typography.body,
  color: colors.primary,
  textAlign: 'center',
  padding: spacing.md,
};
