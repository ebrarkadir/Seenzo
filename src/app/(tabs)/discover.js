import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import PosterTile from '../../components/media/PosterTile';
import EmptyState from '../../components/ui/EmptyState';
import SearchField from '../../components/ui/SearchField';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { rememberMovie, rememberShow } from '../../data/mediaLibrary';
import { colors, spacing, typography } from '../../theme';
import { isMovieWatchlisted, isShowWatchlisted, movieBookmarkVisible, showBookmarkVisible } from '../../tracking/watchlist';
import { getTraktConfigStatus } from '../../services/trakt/config';
import {
  searchMoviesPage,
  searchShowsPage,
  trendingMoviesPage,
  trendingShowsPage,
} from '../../services/trakt/catalog';
import { useTracking } from '../../tracking/TrackingContext';

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
  const requestId = useRef(0);
  const timer = useRef(null);
  const config = getTraktConfigStatus();
  const { shows: trackedShows, movies: trackedMovies, toggleShowWatchlist, toggleMovieWatchlist } = useTracking();

  const onQuery = (text) => {
    setQuery(text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setLoading(true);
      setDebounced(text.trim());
    }, 400);
  };

  useEffect(() => {
    if (!config.ready) {
      return undefined;
    }
    const current = requestId.current + 1;
    requestId.current = current;
    let active = true;
    const searchText = debounced.length >= 2 ? debounced : '';
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
  }, [config.ready, debounced, filter]);

  const loadMore = () => {
    if (!config.ready || loading || page >= pageCount) {
      return;
    }
    const nextPage = page + 1;
    const searchText = debounced.length >= 2 ? debounced : '';
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
        setItems((current) => [...current, ...result.items]);
        setPage(result.page);
        setPageCount(result.pageCount);
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

  const header = (
    <View>
      <SearchField value={query} onChangeText={onQuery} placeholder={t('discover.search')} />
      <SegmentedControl
        value={filter}
        onChange={(value) => {
          setLoading(true);
          setItems([]);
          setManualFilter({ routeType, value });
        }}
        options={[
          { value: 'tv', label: t('discover.shows') },
          { value: 'movie', label: t('discover.movies') },
        ]}
      />
      {loading ? <ActivityIndicator color={colors.primary} style={{ marginBottom: spacing.sm }} /> : null}
      {error ? <Text style={errorStyle}>{t(`trakt.errors.${error.code}`, { status: error.status ?? '', seconds: error.retryAfter ?? '' })}</Text> : null}
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
          const meta = [item.year, item.genres?.[0]].filter(Boolean).join(' · ');
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
