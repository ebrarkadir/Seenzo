import { useMemo, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';
import DraggableFlatList from 'react-native-draggable-flatlist';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import WatchedMoviesGrid from '../../components/media/WatchedMoviesGrid';
import MovieDetailSheet from '../../components/tracking/MovieDetailSheet';
import WatchlistModeToggle from '../../components/tracking/WatchlistModeToggle';
import WatchlistOrderRow from '../../components/tracking/WatchlistOrderRow';
import WatchlistSortSelect from '../../components/tracking/WatchlistSortSelect';
import EmptyState from '../../components/ui/EmptyState';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { mediaGenreLine, mediaTitle } from '../../data/labels';
import { resolveMovie, useMediaRevision } from '../../data/mediaLibrary';
import { useProfile } from '../../profile/ProfileContext';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import {
  PREFERENCE_CONFIDENCE_HISTORY,
  WATCHLIST_SORT_FOR_YOU,
  buildPreferenceProfile,
  rankCandidates,
} from '../../tracking/preferenceProfile';
import {
  MY_LIST_SORT_MY_ORDER,
  sortWatchlistItems,
} from '../../tracking/watchlistSort';
import { sortItemsByWatchlistOrder } from '../../tracking/watchlistOrder';

const MAIN_MY_LIST = 'myList';
const MAIN_FOR_YOU = 'forYou';

export default function MoviesScreen() {
  const { t } = useTranslation();
  const {
    movies,
    movieWatchlistOrder,
    saveMovie,
    moveMovieWatchlistOrder,
    reorderMovieWatchlist,
  } = useTracking();
  const { favorites } = useProfile();
  const revision = useMediaRevision();
  const [segment, setSegment] = useState('toWatch');
  const [mainMode, setMainMode] = useState(MAIN_MY_LIST);
  const [listSort, setListSort] = useState(MY_LIST_SORT_MY_ORDER);
  const [query, setQuery] = useState('');
  const [sheetMovieId, setSheetMovieId] = useState(null);

  const favoriteMovieIds = useMemo(
    () => (favorites?.movies || []).map((item) => item.mediaId).filter(Boolean),
    [favorites]
  );

  const toWatchBase = useMemo(() => {
    if (revision < 0) {
      return [];
    }
    return Object.entries(movies)
      .map(([id, entry]) => ({ id, movie: resolveMovie(id), entry }))
      .filter((item) => item.movie && item.entry.saved && !item.entry.watched);
  }, [movies, revision]);

  const positionById = useMemo(() => {
    const map = new Map();
    (movieWatchlistOrder || []).forEach((id, index) => {
      map.set(id, index + 1);
    });
    return map;
  }, [movieWatchlistOrder]);

  const preferenceProfile = useMemo(() => {
    if (revision < 0 || mainMode !== MAIN_FOR_YOU) {
      return null;
    }
    return buildPreferenceProfile(
      { movies },
      { mediaKind: 'movie', resolveMovie, favoriteMovieIds }
    );
  }, [favoriteMovieIds, mainMode, movies, revision]);

  const orderedForMyList = useMemo(() => sortWatchlistItems(toWatchBase, {
    mode: listSort,
    order: movieWatchlistOrder,
    getId: (item) => item.id,
    getTitle: (item) => mediaTitle(t, item.movie),
    getMedia: (item) => item.movie,
    getAddedAt: (item) => item.entry?.watchlistAddedAt,
  }), [listSort, movieWatchlistOrder, t, toWatchBase]);

  const forYouItems = useMemo(() => {
    if (!preferenceProfile?.ready) {
      return sortItemsByWatchlistOrder(toWatchBase, movieWatchlistOrder, (item) => item.id);
    }
    return rankCandidates(toWatchBase, {
      profile: preferenceProfile,
      mode: WATCHLIST_SORT_FOR_YOU,
      getId: (item) => item.id,
      getTitle: (item) => mediaTitle(t, item.movie),
      getMedia: (item) => item.movie,
    });
  }, [movieWatchlistOrder, preferenceProfile, t, toWatchBase]);

  const visibleItems = useMemo(() => {
    const source = mainMode === MAIN_FOR_YOU ? forYouItems : orderedForMyList;
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return source;
    }
    return source.filter((item) => mediaTitle(t, item.movie).toLowerCase().includes(needle));
  }, [forYouItems, mainMode, orderedForMyList, query, t]);

  const myOrderMode = mainMode === MAIN_MY_LIST && listSort === MY_LIST_SORT_MY_ORDER;
  const dragEnabled = myOrderMode && !query.trim();
  const showForYouHint = mainMode === MAIN_FOR_YOU
    && preferenceProfile
    && !preferenceProfile.ready
    && toWatchBase.length > 0;
  const showForYouHistoryNote = mainMode === MAIN_FOR_YOU
    && preferenceProfile?.ready
    && preferenceProfile.confidence === PREFERENCE_CONFIDENCE_HISTORY
    && toWatchBase.length > 0;
  const forYouHintText = preferenceProfile?.reason === 'insufficient_history'
    ? t('movies.forYouNeedHistory')
    : t('movies.forYouNeedRatings');

  const markWatchedAndOpen = (movieId) => {
    const id = String(movieId || '').trim();
    if (!id) {
      return;
    }
    saveMovie(id, { watched: true, saved: true });
    setSheetMovieId(id);
  };

  const header = (
    <View>
      <SegmentedControl
        value={segment}
        onChange={setSegment}
        options={[
          { value: 'toWatch', label: t('movies.toWatch') },
          { value: 'watched', label: t('movies.watched') },
        ]}
      />
      {segment === 'toWatch' ? (
        <View style={styles.controls}>
          <WatchlistModeToggle
            value={mainMode}
            onChange={setMainMode}
            options={[
              { value: MAIN_MY_LIST, label: t('watchlist.main.myList') },
              { value: MAIN_FOR_YOU, label: t('watchlist.main.forYou') },
            ]}
          />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder={t('watchlist.searchPlaceholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.search}
            autoCorrect={false}
            autoCapitalize="none"
            clearButtonMode="while-editing"
          />
          {mainMode === MAIN_MY_LIST ? (
            <WatchlistSortSelect value={listSort} onChange={setListSort} />
          ) : null}
          {showForYouHint ? (
            <Text style={styles.note}>{forYouHintText}</Text>
          ) : null}
          {showForYouHistoryNote ? (
            <Text style={styles.note}>{t('movies.forYouBasedOnHistory')}</Text>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  if (segment === 'watched') {
    return (
      <View style={styles.screen}>
        <WatchedMoviesGrid
          header={(
            <SegmentedControl
              value={segment}
              onChange={setSegment}
              options={[
                { value: 'toWatch', label: t('movies.toWatch') },
                { value: 'watched', label: t('movies.watched') },
              ]}
            />
          )}
          emptyTitle={t('movies.watchedEmptyTitle')}
          emptyBody={t('movies.watchedEmptyBody')}
          emptyActionLabel={t('movies.discover')}
          onEmptyAction={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'movie' } })}
        />
        <MovieDetailSheet
          visible={Boolean(sheetMovieId)}
          movieId={sheetMovieId}
          onClose={() => setSheetMovieId(null)}
        />
      </View>
    );
  }

  const renderRow = ({ item, drag, isActive }) => {
    const position = positionById.get(item.id) || 0;
    return (
      <WatchlistOrderRow
        item={item}
        media={item.movie}
        position={position}
        showPosition={myOrderMode || Boolean(query.trim())}
        editablePosition={myOrderMode}
        dragEnabled={dragEnabled}
        drag={drag}
        isActive={isActive}
        onPress={() => router.push(`/movie/${item.movie.id}`)}
        onMoveToPosition={(row, nextPosition) => moveMovieWatchlistOrder(row.id, nextPosition)}
        genreLine={mediaGenreLine(t, item.movie)}
        trailing={(
          <Text
            accessibilityRole="button"
            onPress={() => markWatchedAndOpen(item.movie.id)}
            style={styles.mark}
          >
            {t('movies.markWatched')}
          </Text>
        )}
      />
    );
  };

  return (
    <GestureHandlerRootView style={styles.screen}>
      {dragEnabled ? (
        <DraggableFlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          ListEmptyComponent={(
            <EmptyState
              title={t('movies.emptyTitle')}
              body={t('movies.emptyBody')}
              primaryLabel={t('movies.discover')}
              onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'movie' } })}
            />
          )}
          onDragEnd={({ data }) => {
            reorderMovieWatchlist(data.map((item) => item.id));
          }}
          renderItem={renderRow}
        />
      ) : (
        <DraggableFlatList
          data={visibleItems}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.listContent}
          activationDistance={Number.MAX_SAFE_INTEGER}
          ListEmptyComponent={(
            <EmptyState
              title={query.trim() ? t('watchlist.searchEmpty') : t('movies.emptyTitle')}
              body={query.trim() ? t('watchlist.searchEmptyBody') : t('movies.emptyBody')}
              primaryLabel={query.trim() ? null : t('movies.discover')}
              onPrimary={query.trim() ? undefined : () => router.push({ pathname: '/(tabs)/discover', params: { type: 'movie' } })}
            />
          )}
          renderItem={(params) => renderRow({ ...params, drag: undefined })}
        />
      )}
      <MovieDetailSheet
        visible={Boolean(sheetMovieId)}
        movieId={sheetMovieId}
        onClose={() => setSheetMovieId(null)}
      />
    </GestureHandlerRootView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  controls: {
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  search: {
    marginHorizontal: spacing.md,
    minHeight: 40,
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    color: colors.text,
    paddingHorizontal: spacing.md,
    ...typography.body,
  },
  note: {
    ...typography.caption,
    color: colors.textSecondary,
    marginHorizontal: spacing.md,
  },
  listContent: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.lg,
    flexGrow: 1,
  },
  mark: {
    ...typography.label,
    color: colors.primary,
    paddingHorizontal: spacing.xs,
  },
});
