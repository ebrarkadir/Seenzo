import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { mediaTitle } from '../../data/labels';
import { resolveMovie, resolveShow } from '../../data/mediaLibrary';
import { PROFILE_FAVORITES_LIMIT } from '../../services/supabase/profileRules';
import { colors, radii, spacing, typography } from '../../theme';
import PosterThumb from '../ui/PosterThumb';

export default function FavoriteShelf({
  title,
  mediaType,
  items = [],
  editing = false,
  onToggleEdit,
  onPressEmpty,
  onPressFilled,
  onRemove,
  onMoveLeft,
  onMoveRight,
}) {
  const { t } = useTranslation();
  const { width } = useWindowDimensions();
  const horizontalPad = spacing.md * 2;
  const gaps = spacing.sm * (PROFILE_FAVORITES_LIMIT - 1);
  const tileWidth = Math.floor((width - horizontalPad - gaps) / PROFILE_FAVORITES_LIMIT);
  const tileHeight = Math.round(tileWidth * 1.5);
  const byPosition = new Map((items || []).map((item) => [item.position, item]));

  return (
    <View style={styles.block}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        <Pressable accessibilityRole="button" onPress={onToggleEdit} hitSlop={8}>
          <Text style={styles.edit}>{editing ? t('common.done') : t('common.edit')}</Text>
        </Pressable>
      </View>
      <View style={styles.row}>
        {Array.from({ length: PROFILE_FAVORITES_LIMIT }, (_, index) => {
          const position = index + 1;
          const item = byPosition.get(position);
          const media = item
            ? (mediaType === 'movie' ? resolveMovie(item.mediaId) : resolveShow(item.mediaId))
            : null;
          if (!item) {
            return (
              <Pressable
                key={`empty-${position}`}
                accessibilityRole="button"
                accessibilityLabel={t(mediaType === 'movie' ? 'profile.addFavoriteMovie' : 'profile.addFavoriteShow')}
                onPress={() => onPressEmpty?.(position)}
                style={[styles.slot, { width: tileWidth, height: tileHeight }]}
              >
                <Ionicons name="add" size={28} color={colors.primary} />
              </Pressable>
            );
          }
          return (
            <View key={`fav-${item.mediaId}`} style={{ width: tileWidth }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={media ? mediaTitle(t, media) : item.mediaId}
                onPress={() => (editing ? onPressEmpty?.(position, item) : onPressFilled?.(item, media))}
              >
                {media ? (
                  <PosterThumb
                    uri={media.poster}
                    posterPath={media.posterPath}
                    width={tileWidth}
                    height={tileHeight}
                  />
                ) : (
                  <View style={[styles.slot, { width: tileWidth, height: tileHeight }]}>
                    <Ionicons name="film-outline" size={22} color={colors.textSecondary} />
                  </View>
                )}
              </Pressable>
              {editing ? (
                <View style={styles.editRow}>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('profile.moveFavoriteLeft')}
                    disabled={position <= 1}
                    onPress={() => onMoveLeft?.(position)}
                    hitSlop={6}
                  >
                    <Ionicons name="chevron-back" size={16} color={position <= 1 ? colors.textMuted : colors.text} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('profile.removeFavorite')}
                    onPress={() => onRemove?.(position)}
                    hitSlop={6}
                  >
                    <Ionicons name="close" size={16} color={colors.status.dropped} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={t('profile.moveFavoriteRight')}
                    disabled={position >= PROFILE_FAVORITES_LIMIT || !byPosition.get(position + 1)}
                    onPress={() => onMoveRight?.(position)}
                    hitSlop={6}
                  >
                    <Ionicons
                      name="chevron-forward"
                      size={16}
                      color={position >= PROFILE_FAVORITES_LIMIT || !byPosition.get(position + 1) ? colors.textMuted : colors.text}
                    />
                  </Pressable>
                </View>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  edit: {
    ...typography.label,
    color: colors.primary,
  },
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  slot: {
    borderRadius: radii.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderStyle: 'dashed',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editRow: {
    marginTop: 4,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
});
