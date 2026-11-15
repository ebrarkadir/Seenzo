import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import { MoviePoster } from '../../components/media/LibraryTiles';
import WatchedMoviesGrid from '../../components/media/WatchedMoviesGrid';
import MovieDetailSheet from '../../components/tracking/MovieDetailSheet';
import EmptyState from '../../components/ui/EmptyState';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { mediaTitle } from '../../data/labels';
import { resolveMovie, useMediaRevision } from '../../data/mediaLibrary';
import { colors, spacing } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function MoviesScreen() {
  const { t } = useTranslation();
  const { movies, saveMovie } = useTracking();
  const revision = useMediaRevision();
  const [segment, setSegment] = useState('toWatch');
  const [sheetMovieId, setSheetMovieId] = useState(null);

  const toWatch = useMemo(() => {
    if (revision < 0) {
      return [];
    }
    return Object.entries(movies)
      .map(([id, entry]) => ({ id, movie: resolveMovie(id), entry }))
      .filter((item) => item.movie && item.entry.saved && !item.entry.watched)
      .sort((a, b) => mediaTitle(t, a.movie).localeCompare(mediaTitle(t, b.movie)));
  }, [movies, revision, t]);

  const header = (
    <SegmentedControl
      value={segment}
      onChange={setSegment}
      options={[
        { value: 'toWatch', label: t('movies.toWatch') },
        { value: 'watched', label: t('movies.watched') },
      ]}
    />
  );

  const markWatchedAndOpen = (movieId) => {
    const id = String(movieId || '').trim();
    if (!id) {
      return;
    }
    // Capture id before list moves the movie out of To Watch.
    saveMovie(id, { watched: true, saved: true });
    setSheetMovieId(id);
  };

  if (segment === 'watched') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <WatchedMoviesGrid
          header={header}
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

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PosterGrid
        data={toWatch}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentBottom={spacing.lg}
        ListEmptyComponent={
          <EmptyState
            title={t('movies.emptyTitle')}
            body={t('movies.emptyBody')}
            primaryLabel={t('movies.discover')}
            onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'movie' } })}
          />
        }
        renderItem={(item, size) => (
          <MoviePoster
            movie={item.movie}
            rating={item.entry.rating}
            width={size.width}
            height={size.height}
            onPress={() => router.push(`/movie/${item.movie.id}`)}
            onMarkWatched={() => markWatchedAndOpen(item.movie.id)}
          />
        )}
      />
      <MovieDetailSheet
        visible={Boolean(sheetMovieId)}
        movieId={sheetMovieId}
        onClose={() => setSheetMovieId(null)}
      />
    </View>
  );
}
