import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import { colors, radii, spacing, typography } from '../../theme';

export default function MostWatchedShows({ items = [], onPressShow }) {
  const { t } = useTranslation();

  if (!items.length) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('insights.mostWatchedTitle')}</Text>
        <Text style={styles.empty}>{t('insights.mostWatchedEmpty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('insights.mostWatchedTitle')}</Text>
      <Text style={styles.subtitle}>{t('insights.mostWatchedBody')}</Text>
      <View style={styles.list}>
        {items.map((item, index) => (
          <Pressable
            key={item.showId}
            accessibilityRole="button"
            accessibilityLabel={t('insights.mostWatchedA11y', {
              title: item.title,
              count: item.watchedCount,
            })}
            onPress={() => onPressShow?.(item.showId)}
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <Text style={styles.rank}>{index + 1}</Text>
            <PosterThumb posterPath={item.posterPath} width={40} height={60} />
            <View style={styles.copy}>
              <Text style={styles.showTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.meta} numberOfLines={1}>
                {item.totalEpisodes != null && item.totalEpisodes > 0
                  ? t('insights.mostWatchedProgress', {
                    watched: item.watchedCount,
                    total: item.totalEpisodes,
                  })
                  : t('insights.mostWatchedCount', { count: item.watchedCount })}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
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
  empty: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  list: {
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  pressed: {
    opacity: 0.88,
  },
  rank: {
    ...typography.label,
    color: colors.primary,
    width: 16,
    textAlign: 'center',
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  showTitle: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
