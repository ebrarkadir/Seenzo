import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import PosterThumb from '../ui/PosterThumb';
import { colors, radii, spacing, typography } from '../../theme';

function PersonalRatingRow({ item, onPress, onEdit }) {
  const { t } = useTranslation();
  if (!item) {
    return null;
  }

  let meta = '';
  if (item.kind === 'movie') {
    meta = item.year
      ? t('personalRatings.metaMovieYear', { year: item.year })
      : t('personalRatings.metaMovie');
  } else if (item.kind === 'show') {
    meta = item.year
      ? t('personalRatings.metaShowYear', { year: item.year })
      : t('personalRatings.metaShow');
  } else {
    const code = item.episodeCode || t('common.episodeCode', {
      season: String(item.season ?? 0).padStart(2, '0'),
      episode: String(item.number ?? 0).padStart(2, '0'),
    });
    meta = item.showTitle
      ? t('personalRatings.metaEpisodeShow', { show: item.showTitle, code })
      : code;
  }

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${item.title}, ${t('common.ratingValue', { rating: item.rating })}`}
      onPress={onPress}
      style={styles.row}
    >
      <PosterThumb posterPath={item.posterPath} width={48} height={72} />
      <View style={styles.copy}>
        <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
        <Text style={styles.meta} numberOfLines={1}>{meta}</Text>
        <Text style={styles.rating}>★ {t('common.ratingValue', { rating: item.rating })}</Text>
        {!item.editable ? (
          <Text style={styles.locked} numberOfLines={1}>{t('personalRatings.editLocked')}</Text>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('common.edit')}
        hitSlop={8}
        onPress={onEdit}
        style={styles.edit}
      >
        <Text style={styles.editText}>{t('common.edit')}</Text>
      </Pressable>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.background,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
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
  rating: {
    ...typography.label,
    color: colors.primary,
    marginTop: 2,
  },
  locked: {
    ...typography.label,
    color: colors.textMuted,
    fontWeight: '500',
  },
  edit: {
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  editText: {
    ...typography.label,
    color: colors.primary,
  },
});

export default memo(PersonalRatingRow);
