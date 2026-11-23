import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

const FILTERS = ['all', 'movie', 'episode'];
const MONTH_KEYS = [
  'jan', 'feb', 'mar', 'apr', 'may', 'jun',
  'jul', 'aug', 'sep', 'oct', 'nov', 'dec',
];

export default function ViewingActivitySection({
  activity,
  filter = 'all',
  onChangeFilter,
  selectedMonth,
  onSelectMonth,
  onChangeYear,
}) {
  const { t } = useTranslation();
  const hasEvents = Boolean(activity?.hasLoggingEvents);
  const months = activity?.monthly?.months || [];
  const maxTotal = months.reduce((max, item) => Math.max(max, item.total || 0), 0);
  const selected = months.find((item) => item.month === selectedMonth);
  const years = activity?.years || [];
  const selectedYear = activity?.selectedYear;

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('insights.activityTitle')}</Text>
      <Text style={styles.subtitle}>{t('insights.activitySubtitle')}</Text>

      {!hasEvents ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>{t('insights.activityEmptyTitle')}</Text>
          <Text style={styles.emptyBody}>{t('insights.activityEmptyBody')}</Text>
          <Text style={styles.historyNote}>{t('insights.activityHistoryNote')}</Text>
        </View>
      ) : (
        <>
          <Text style={styles.loggingNote}>{t('insights.activityLoggingNote')}</Text>

          {years.length > 1 ? (
            <View style={styles.years}>
              {years.map((year) => {
                const active = year === selectedYear;
                return (
                  <Pressable
                    key={year}
                    accessibilityRole="button"
                    accessibilityState={{ selected: active }}
                    onPress={() => onChangeYear?.(year)}
                    style={[styles.chip, active && styles.chipActive]}
                  >
                    <Text style={[styles.chipText, active && styles.chipTextActive]}>{year}</Text>
                  </Pressable>
                );
              })}
            </View>
          ) : selectedYear ? (
            <Text style={styles.yearLabel}>{selectedYear}</Text>
          ) : null}

          <View style={styles.filters}>
            {FILTERS.map((key) => {
              const active = filter === key;
              return (
                <Pressable
                  key={key}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  onPress={() => onChangeFilter?.(key)}
                  style={[styles.chip, active && styles.chipActive]}
                >
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>
                    {t(`insights.activityFilters.${key}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          <View style={styles.chart}>
            {months.map((item) => {
              const height = maxTotal > 0 ? Math.max(4, (item.total / maxTotal) * 104) : 4;
              const active = selectedMonth === item.month;
              return (
                <Pressable
                  key={item.month}
                  accessibilityRole="button"
                  accessibilityLabel={t('insights.activityBarA11y', {
                    month: t(`insights.months.${MONTH_KEYS[item.month - 1]}`),
                    count: item.total,
                  })}
                  onPress={() => onSelectMonth?.(active ? null : item.month)}
                  style={styles.barCol}
                >
                  <View style={styles.barTrack}>
                    <View
                      style={[
                        styles.barFill,
                        { height },
                        active && styles.barFillActive,
                        item.total === 0 && styles.barEmpty,
                      ]}
                    />
                  </View>
                  <Text style={[styles.barLabel, active && styles.barLabelActive]}>
                    {t(`insights.monthsShort.${MONTH_KEYS[item.month - 1]}`)}
                  </Text>
                </Pressable>
              );
            })}
          </View>

          {selected ? (
            <Text style={styles.selection}>
              {t('insights.activitySelected', {
                month: t(`insights.months.${MONTH_KEYS[selected.month - 1]}`),
                movies: selected.movies,
                episodes: selected.episodes,
              })}
            </Text>
          ) : (
            <Text style={styles.selection}>{t('insights.activityTapHint')}</Text>
          )}

          <View style={styles.summaryRow}>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{activity.summary.activeDays}</Text>
              <Text style={styles.summaryLabel}>{t('insights.activityActiveDays')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{activity.summary.moviesLogged}</Text>
              <Text style={styles.summaryLabel}>{t('insights.activityMoviesLogged')}</Text>
            </View>
            <View style={styles.summaryCard}>
              <Text style={styles.summaryValue}>{activity.summary.episodesLogged}</Text>
              <Text style={styles.summaryLabel}>{t('insights.activityEpisodesLogged')}</Text>
            </View>
          </View>

          <Text style={styles.historyNote}>{t('insights.activityHistoryNote')}</Text>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    gap: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  loggingNote: {
    ...typography.caption,
    color: colors.textMuted,
  },
  empty: {
    gap: 2,
    paddingTop: spacing.xs,
  },
  emptyTitle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  emptyBody: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  years: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  yearLabel: {
    ...typography.caption,
    color: colors.primary,
    fontWeight: '600',
  },
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    borderColor: colors.primary,
    backgroundColor: '#1A2A38',
  },
  chipText: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 2,
    minHeight: 128,
    paddingTop: spacing.sm,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.xs,
  },
  barTrack: {
    height: 108,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: '70%',
    maxWidth: 18,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    opacity: 0.85,
  },
  barFillActive: {
    opacity: 1,
    backgroundColor: '#A6DBFF',
  },
  barEmpty: {
    opacity: 0.25,
    backgroundColor: colors.textMuted,
  },
  barLabel: {
    fontSize: 10,
    lineHeight: 12,
    color: colors.textMuted,
  },
  barLabelActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  selection: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  summaryRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  summaryCard: {
    flex: 1,
    gap: 2,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  summaryValue: {
    ...typography.subtitle,
    color: colors.text,
  },
  summaryLabel: {
    ...typography.caption,
    color: colors.textMuted,
  },
  historyNote: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
