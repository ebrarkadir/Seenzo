import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import { ShowPoster } from '../../components/media/LibraryTiles';
import EmptyState from '../../components/ui/EmptyState';
import SegmentedControl from '../../components/ui/SegmentedControl';
import ShowCard from '../../components/tracking/ShowCard';
import UpcomingRow from '../../components/tracking/UpcomingRow';
import UndoBar from '../../components/tracking/UndoBar';
import { mediaTitle } from '../../data/labels';
import { resolveShow, useMediaRevision } from '../../data/mediaLibrary';
import { colors, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import { useUndoTimer } from '../../tracking/useUndoTimer';
import { deriveShowStatus, upcomingForShows } from '../../tracking/status';

export default function TvShowsScreen() {
  const { t } = useTranslation();
  const { shows, undo, markNextWatched, removeShow } = useTracking();
  const revision = useMediaRevision();
  const [segment, setSegment] = useState('watching');
  useUndoTimer();

  const tracked = useMemo(() => {
    if (revision < 0) {
      return [];
    }
    return Object.entries(shows)
      .map(([id, entry]) => ({ show: resolveShow(id), entry }))
      .filter((item) => item.show);
  }, [revision, shows]);

  const watching = useMemo(() => {
    return tracked
      .filter((item) => deriveShowStatus(item.show, item.entry) === 'watching')
      .sort((a, b) => mediaTitle(t, a.show).localeCompare(mediaTitle(t, b.show)));
  }, [t, tracked]);

  const planned = useMemo(() => {
    return tracked
      .filter((item) => deriveShowStatus(item.show, item.entry) === 'plan')
      .sort((a, b) => mediaTitle(t, a.show).localeCompare(mediaTitle(t, b.show)));
  }, [t, tracked]);

  const upcomingAll = useMemo(() => upcomingForShows(tracked), [tracked]);
  const upcoming = upcomingAll.slice(0, 3);

  const segmentControl = (
    <SegmentedControl
      value={segment}
      onChange={setSegment}
      options={[
        { value: 'watching', label: t('tv.segment.watching') },
        { value: 'watchlist', label: t('tv.segment.watchlist') },
      ]}
    />
  );

  if (segment === 'watchlist') {
    return (
      <View style={styles.screen}>
        <PosterGrid
          data={planned}
          keyExtractor={(item) => item.show.id}
          ListHeaderComponent={segmentControl}
          contentBottom={spacing.lg}
          ListEmptyComponent={
            <EmptyState
              title={t('watchlist.emptyShowsTitle')}
              body={t('watchlist.emptyShowsBody')}
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
              onRemove={() => removeShow(item.show.id)}
            />
          )}
        />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={{ paddingBottom: undo ? 96 : spacing.lg }}>
        {segmentControl}
        {watching.length === 0 ? (
          <EmptyState
            title={t('tv.emptyTitle')}
            body={t('tv.emptyBody')}
            primaryLabel={t('tv.addFirstShow')}
            onPrimary={() => router.push({ pathname: '/(tabs)/discover', params: { type: 'tv' } })}
          />
        ) : (
          watching.map(({ show, entry }) => (
            <ShowCard
              key={show.id}
              show={show}
              entry={entry}
              onPress={() => router.push(`/show/${show.id}`)}
              primaryLabel={t('tv.markWatched')}
              onPrimary={() => markNextWatched(show.id)}
            />
          ))
        )}
        {upcomingAll.length ? (
          <View style={styles.upcoming}>
            <View style={styles.sectionRow}>
              <Text style={styles.section}>{t('tv.upcomingSection')}</Text>
              <Pressable accessibilityRole="button" onPress={() => router.push('/upcoming')} hitSlop={8}>
                <Text style={styles.seeAll}>{t('tv.seeAll')}</Text>
              </Pressable>
            </View>
            {upcoming.map((item) => (
              <UpcomingRow key={item.id} item={item} onPress={() => router.push(`/show/${item.show.id}`)} />
            ))}
          </View>
        ) : null}
      </ScrollView>
      <UndoBar />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  upcoming: {
    marginTop: spacing.sm,
  },
  sectionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  section: {
    ...typography.subtitle,
    color: colors.text,
  },
  seeAll: {
    ...typography.label,
    color: colors.primary,
  },
});
