import { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import UpcomingRow from '../components/tracking/UpcomingRow';
import { getShow } from '../data/catalog';
import { colors, radii, spacing, typography } from '../theme';
import { useTracking } from '../tracking/TrackingContext';
import { upcomingForShows } from '../tracking/status';

const FILTERS = ['all', 'episode', 'season'];

export default function UpcomingScreen() {
  const { t } = useTranslation();
  const { shows } = useTracking();
  const [filter, setFilter] = useState('all');

  const items = useMemo(() => {
    const tracked = Object.entries(shows)
      .map(([id, entry]) => ({ show: getShow(id), entry }))
      .filter((item) => item.show);
    const upcoming = upcomingForShows(tracked);
    if (filter === 'all') {
      return upcoming;
    }
    return upcoming.filter((item) => item.kind === filter);
  }, [filter, shows]);

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.filters}>
        {FILTERS.map((value) => {
          const selected = value === filter;
          return (
            <Pressable
              key={value}
              accessibilityRole="button"
              accessibilityState={{ selected }}
              onPress={() => setFilter(value)}
              style={[styles.chip, selected && styles.chipSelected]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{t(`upcoming.filters.${value}`)}</Text>
            </Pressable>
          );
        })}
      </View>
      {items.length === 0 ? <Text style={styles.empty}>{t('upcoming.empty')}</Text> : null}
      {items.map((item) => (
        <UpcomingRow key={item.id} item={item} onPress={() => router.push(`/show/${item.show.id}`)} />
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingTop: spacing.md,
    paddingBottom: spacing.xl,
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
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
});
