import { useMemo } from 'react';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import { mediaTitle } from '../../data/labels';
import { resolveMovie, useMediaRevision } from '../../data/mediaLibrary';
import { spacing } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import EmptyState from '../ui/EmptyState';
import { MoviePoster } from './LibraryTiles';
import PosterGrid from './PosterGrid';

export default function WatchedMoviesGrid({ header, emptyTitle, emptyBody, emptyActionLabel, onEmptyAction }) {
  const { t } = useTranslation();
  const { movies } = useTracking();
  const revision = useMediaRevision();

  const items = useMemo(() => {
    if (revision < 0) {
      return [];
    }
    return Object.entries(movies)
      .map(([id, entry]) => ({ id, movie: resolveMovie(id), entry }))
      .filter((item) => item.movie && item.entry.watched)
      .sort((a, b) => mediaTitle(t, a.movie).localeCompare(mediaTitle(t, b.movie)));
  }, [movies, revision, t]);

  return (
    <PosterGrid
      data={items}
      keyExtractor={(item) => item.id}
      ListHeaderComponent={header}
      contentBottom={spacing.xl}
      ListEmptyComponent={
        <EmptyState
          title={emptyTitle}
          body={emptyBody}
          primaryLabel={emptyActionLabel}
          onPrimary={onEmptyAction}
        />
      }
      renderItem={(item, size) => (
        <MoviePoster
          movie={item.movie}
          watched
          rating={item.entry.rating}
          width={size.width}
          height={size.height}
          onPress={() => router.push(`/movie/${item.movie.id}`)}
        />
      )}
    />
  );
}
