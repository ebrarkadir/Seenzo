import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import { MoviePoster } from '../../components/media/LibraryTiles';
import WatchedMoviesGrid from '../../components/media/WatchedMoviesGrid';
import EmptyState from '../../components/ui/EmptyState';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { getMovie } from '../../data/catalog';
import { colors, spacing } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function MoviesScreen() {
  const { t } = useTranslation();
  const { movies, saveMovie } = useTracking();
  const [segment, setSegment] = useState('toWatch');

  const toWatch = useMemo(() => {
    return Object.entries(movies)
      .map(([id, entry]) => ({ id, movie: getMovie(id), entry }))
      .filter((item) => item.movie && item.entry.saved && !item.entry.watched)
      .sort((a, b) => t(a.movie.titleKey).localeCompare(t(b.movie.titleKey)));
  }, [movies, t]);

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
            onMarkWatched={() => saveMovie(item.movie.id, { watched: true, saved: true })}
          />
        )}
      />
    </View>
  );
}
