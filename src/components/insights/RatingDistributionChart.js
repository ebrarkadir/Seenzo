import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

const FILTERS = ['all', 'movie', 'show', 'episode'];

export default function RatingDistributionChart({
  data = [],
  filter = 'all',
  onChangeFilter,
  selectedScore,
  onSelectScore,
}) {
  const { t } = useTranslation();
  const maxCount = data.reduce((max, item) => Math.max(max, item.count || 0), 0);
  const selected = data.find((item) => item.score === selectedScore);

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('insights.ratingDistribution')}</Text>
      <Text style={styles.subtitle}>{t('insights.ratingDistributionBody')}</Text>

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
                {t(`insights.filters.${key}`)}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <View style={styles.chart}>
        {data.map((item) => {
          const height = maxCount > 0 ? Math.max(4, (item.count / maxCount) * 96) : 4;
          const active = selectedScore === item.score;
          return (
            <Pressable
              key={item.score}
              accessibilityRole="button"
              accessibilityLabel={t('insights.ratingBarA11y', {
                score: item.score,
                count: item.count,
              })}
              onPress={() => onSelectScore?.(active ? null : item.score)}
              style={styles.barCol}
            >
              <View style={styles.barTrack}>
                <View
                  style={[
                    styles.barFill,
                    { height },
                    active && styles.barFillActive,
                    item.count === 0 && styles.barEmpty,
                  ]}
                />
              </View>
              <Text style={[styles.barLabel, active && styles.barLabelActive]}>{item.score}</Text>
            </Pressable>
          );
        })}
      </View>

      {selected ? (
        <Text style={styles.selection}>
          {t('insights.ratingSelected', { score: selected.score, count: selected.count })}
        </Text>
      ) : (
        <Text style={styles.selection}>{t('insights.ratingTapHint')}</Text>
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
  filters: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.xs,
  },
  chip: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  chipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  chipText: {
    ...typography.label,
    color: colors.textSecondary,
  },
  chipTextActive: {
    color: colors.onPrimary,
  },
  chart: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: 4,
    minHeight: 124,
    paddingTop: spacing.sm,
  },
  barCol: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  barTrack: {
    width: '100%',
    height: 100,
    justifyContent: 'flex-end',
    alignItems: 'center',
  },
  barFill: {
    width: '72%',
    maxWidth: 18,
    borderRadius: radii.sm,
    backgroundColor: colors.primary,
    opacity: 0.85,
  },
  barFillActive: {
    opacity: 1,
    backgroundColor: colors.primary,
  },
  barEmpty: {
    backgroundColor: colors.border,
    opacity: 1,
    height: 4,
  },
  barLabel: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '500',
  },
  barLabelActive: {
    color: colors.primary,
  },
  selection: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
