import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import PrimaryButton from '../ui/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme';

export default function MovieCard({
  movie,
  watched,
  rating,
  onPress,
  primaryLabel,
  onPrimary,
  secondaryLabel,
  onSecondary,
}) {
  const { t } = useTranslation();
  const status = watched ? 'completed' : 'plan';

  return (
    <View style={styles.card}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('movies.openMovie', { title: t(movie.titleKey) })}
        onPress={onPress}
        style={styles.row}
      >
        <PosterThumb uri={movie.poster} status={status} />
        <View style={styles.body}>
          <Text style={styles.title} numberOfLines={2}>
            {t(movie.titleKey)}
          </Text>
          <Text style={styles.meta}>
            {movie.year} · {t(movie.genreKey)}
          </Text>
          <Text style={[styles.state, { color: colors.status[status] }]}>
            {watched ? t('movies.watched') : t('movies.toWatch')}
            {watched && rating ? ` · ${t('common.ratingValue', { rating })}` : ''}
          </Text>
        </View>
      </Pressable>
      {primaryLabel || secondaryLabel ? (
        <View style={styles.actions}>
          {primaryLabel ? <PrimaryButton label={primaryLabel} onPress={onPrimary} style={styles.action} /> : null}
          {secondaryLabel ? (
            <PrimaryButton label={secondaryLabel} onPress={onSecondary} variant="secondary" style={styles.action} />
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm + 2,
    padding: spacing.sm,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm + 4,
  },
  body: {
    flex: 1,
    gap: 4,
  },
  title: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  meta: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  state: {
    ...typography.label,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  action: {
    flex: 1,
  },
});
