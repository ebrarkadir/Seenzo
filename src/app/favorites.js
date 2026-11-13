import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../components/media/PosterGrid';
import { MoviePoster, ShowPoster } from '../components/media/LibraryTiles';
import EmptyState from '../components/ui/EmptyState';
import SegmentedControl from '../components/ui/SegmentedControl';
import { getMovie, getShow } from '../data/catalog';
import { colors, spacing } from '../theme';
import { useTracking } from '../tracking/TrackingContext';

export default function FavoritesScreen() {
  const { t } = useTranslation();
  const { favorites, shows, movies } = useTracking();
  const [segment, setSegment] = useState('tv');

  const showItems = useMemo(() => {
    return Object.keys(favorites?.shows || {})
      .map((id) => ({ id, show: getShow(id), entry: shows[id] }))
      .filter((item) => item.show)
      .sort((a, b) => t(a.show.titleKey).localeCompare(t(b.show.titleKey)));
  }, [favorites, shows, t]);

  const movieItems = useMemo(() => {
    return Object.keys(favorites?.movies || {})
      .map((id) => ({ id, movie: getMovie(id), entry: movies[id] }))
      .filter((item) => item.movie)
      .sort((a, b) => t(a.movie.titleKey).localeCompare(t(b.movie.titleKey)));
  }, [favorites, movies, t]);

  const header = (
    <SegmentedControl
      value={segment}
      onChange={setSegment}
      options={[
        { value: 'tv', label: t('favorites.shows') },
        { value: 'movie', label: t('favorites.movies') },
      ]}
    />
  );

  if (segment === 'movie') {
    return (
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        <PosterGrid
          data={movieItems}
          keyExtractor={(item) => item.id}
          ListHeaderComponent={header}
          contentBottom={spacing.xl}
          ListEmptyComponent={
            <EmptyState
              title={t('favorites.emptyMoviesTitle')}
              body={t('favorites.emptyMoviesBody')}
              primaryLabel={t('movies.discover')}
              onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'movie' } })}
            />
          }
          renderItem={(item, size) => (
            <MoviePoster
              movie={item.movie}
              watched={Boolean(item.entry?.watched)}
              rating={item.entry?.rating}
              width={size.width}
              height={size.height}
              onPress={() => router.push(`/movie/${item.movie.id}`)}
            />
          )}
        />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PosterGrid
        data={showItems}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentBottom={spacing.xl}
        ListEmptyComponent={
          <EmptyState
            title={t('favorites.emptyShowsTitle')}
            body={t('favorites.emptyShowsBody')}
            primaryLabel={t('tv.discoverShows')}
            onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'tv' } })}
          />
        }
        renderItem={(item, size) => (
          <ShowPoster
            show={item.show}
            entry={item.entry}
            width={size.width}
            height={size.height}
            onPress={() => router.push(`/show/${item.show.id}`)}
          />
        )}
      />
    </View>
  );
}
