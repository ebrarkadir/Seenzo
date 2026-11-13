import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import PosterGrid from '../../components/media/PosterGrid';
import { ShowPoster } from '../../components/media/LibraryTiles';
import EmptyState from '../../components/ui/EmptyState';
import { getShow } from '../../data/catalog';
import { colors, radii, spacing, typography } from '../../theme';
import { useTracking } from '../../tracking/TrackingContext';
import { deriveShowStatus } from '../../tracking/status';

const FILTERS = ['all', 'watching', 'caughtUp', 'completed', 'dropped'];

export default function ShowArchiveScreen() {
  const { t } = useTranslation();
  const { shows } = useTracking();
  const [filter, setFilter] = useState('all');

  const items = useMemo(() => {
    return Object.entries(shows)
      .map(([id, entry]) => ({ id, show: getShow(id), entry, status: null }))
      .filter((item) => item.show)
      .map((item) => ({ ...item, status: deriveShowStatus(item.show, item.entry) }))
      .filter((item) => filter === 'all' || item.status === filter)
      .sort((a, b) => t(a.show.titleKey).localeCompare(t(b.show.titleKey)));
  }, [filter, shows, t]);

  return (
    <View style={styles.screen}>
      <PosterGrid
        data={items}
        keyExtractor={(item) => item.id}
        contentBottom={spacing.xl}
        ListHeaderComponent={
          <View style={styles.filters}>
            {FILTERS.map((value) => {
              const selected = value === filter;
              const label = value === 'all' ? t('archive.all') : t(`tv.status.${value}`);
              return (
                <Pressable
                  key={value}
                  accessibilityRole="button"
                  accessibilityState={{ selected }}
                  onPress={() => setFilter(value)}
                  style={[styles.chip, selected && styles.chipSelected]}
                >
                  <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
                </Pressable>
              );
            })}
          </View>
        }
        ListEmptyComponent={<EmptyState title={t('archive.emptyShows')} body={t('archive.emptyShowsBody')} />}
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

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  chip: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  chipSelected: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceElevated,
  },
  chipText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  chipTextSelected: {
    color: colors.primary,
  },
});
