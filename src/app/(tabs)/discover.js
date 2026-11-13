import { useMemo, useState } from 'react';
import { View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import PosterTile from '../../components/media/PosterTile';
import EmptyState from '../../components/ui/EmptyState';
import SearchField from '../../components/ui/SearchField';
import SegmentedControl from '../../components/ui/SegmentedControl';
import { movies, shows } from '../../data/catalog';
import { colors, spacing } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';

export default function DiscoverScreen() {
  const { t } = useTranslation();
  const params = useLocalSearchParams();
  const routeType = params.type === 'movie' || params.type === 'tv' ? params.type : 'tv';
  const [manualFilter, setManualFilter] = useState(null);
  const [query, setQuery] = useState('');
  const filter = manualFilter && manualFilter.routeType === routeType ? manualFilter.value : routeType;
  const { shows: trackedShows, movies: trackedMovies } = useTracking();
  const normalized = query.trim().toLowerCase();

  const visibleShows = useMemo(() => {
    return shows.filter((show) => t(show.titleKey).toLowerCase().includes(normalized));
  }, [normalized, t]);

  const visibleMovies = useMemo(() => {
    return movies.filter((movie) => t(movie.titleKey).toLowerCase().includes(normalized));
  }, [normalized, t]);

  const data = filter === 'tv' ? visibleShows : visibleMovies;
  const header = (
    <View>
      <SearchField value={query} onChangeText={setQuery} placeholder={t('discover.search')} />
      <SegmentedControl
        value={filter}
        onChange={(value) => setManualFilter({ routeType, value })}
        options={[
          { value: 'tv', label: t('discover.shows') },
          { value: 'movie', label: t('discover.movies') },
        ]}
      />
    </View>
  );

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <PosterGrid
        data={data}
        keyExtractor={(item) => item.id}
        ListHeaderComponent={header}
        contentBottom={spacing.lg}
        ListEmptyComponent={<EmptyState title={t('discover.empty')} body={t('discover.emptyBody')} />}
        renderItem={(item, size) => {
          if (filter === 'tv') {
            const tracked = Boolean(trackedShows[item.id]);
            return (
              <PosterTile
                uri={item.poster}
                title={t(item.titleKey)}
                meta={t(`tv.release.${item.releaseStatus}`)}
                badge={tracked ? t('discover.inLibrary') : null}
                width={size.width}
                height={size.height}
                onPress={() => router.push(`/show/${item.id}`)}
              />
            );
          }
          const tracked = Boolean(trackedMovies[item.id]?.saved);
          return (
            <PosterTile
              uri={item.poster}
              title={t(item.titleKey)}
              meta={`${item.year} · ${t(item.genreKey)}`}
              badge={tracked ? t('discover.inLibrary') : null}
              width={size.width}
              height={size.height}
              onPress={() => router.push(`/movie/${item.id}`)}
            />
          );
        }}
      />
    </View>
  );
}
