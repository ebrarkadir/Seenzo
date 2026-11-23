import { StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function GenreBars({ items = [], mediaMissingGenres = 0 }) {
  const { t } = useTranslation();

  if (!items.length) {
    return (
      <View style={styles.card}>
        <Text style={styles.title}>{t('insights.genresTitle')}</Text>
        <Text style={styles.empty}>{t('insights.genresEmpty')}</Text>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>{t('insights.genresTitle')}</Text>
      <Text style={styles.subtitle}>{t('insights.genresBody')}</Text>
      <View style={styles.list}>
        {items.map((item) => (
          <View key={item.genre} style={styles.row}>
            <View style={styles.rowHeader}>
              <Text style={styles.genre} numberOfLines={1}>{item.genre}</Text>
              <Text style={styles.count}>
                {t('insights.genreCount', { count: item.count })}
              </Text>
            </View>
            <View style={styles.track}>
              <View style={[styles.fill, { width: `${Math.max(8, Math.round(item.ratio * 100))}%` }]} />
            </View>
          </View>
        ))}
      </View>
      {mediaMissingGenres > 0 ? (
        <Text style={styles.note}>{t('insights.genresMissingNote', { count: mediaMissingGenres })}</Text>
      ) : null}
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
    gap: 4,
  },
  rowHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  genre: {
    ...typography.label,
    color: colors.text,
    flex: 1,
    textTransform: 'capitalize',
  },
  count: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '500',
  },
  track: {
    height: 8,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    borderRadius: radii.full,
    backgroundColor: colors.primary,
  },
  note: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
