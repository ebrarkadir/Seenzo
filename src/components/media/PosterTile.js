import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing, typography } from '../../theme';
import FavoriteButton from './FavoriteButton';

export function posterSize(windowWidth) {
  const gap = spacing.sm + 4;
  const width = Math.floor((windowWidth - spacing.md * 2 - gap) / 2);
  return { width, height: Math.round(width * 1.5), gap };
}

export default function PosterTile({
  uri,
  title,
  meta,
  width,
  height,
  status,
  selected,
  selectable,
  badge,
  onPress,
  accessibilityLabel,
  accessibilityState,
  quickLabel,
  onQuick,
  favorite,
  onFavorite,
  favoriteLabel,
}) {
  return (
    <View style={{ width }}>
      <Pressable accessibilityRole="button" accessibilityLabel={accessibilityLabel || title} accessibilityState={accessibilityState} onPress={onPress}>
        <View>
          <Image source={{ uri }} resizeMode="cover" style={[styles.image, { width, height }]} />
          {status ? <View style={[styles.indicator, { backgroundColor: colors.status[status] || colors.textMuted }]} /> : null}
          {selected || selectable ? (
            <View style={[styles.check, !selected && styles.checkIdle]}>
              {selected ? <Ionicons name="checkmark" size={16} color={colors.onPrimary} /> : null}
            </View>
          ) : null}
          {badge ? (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{badge}</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
      {onFavorite ? (
        <FavoriteButton active={favorite} label={favoriteLabel} onPress={onFavorite} style={styles.favorite} />
      ) : null}
      {onQuick ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={quickLabel}
          onPress={onQuick}
          hitSlop={8}
          style={styles.quick}
        >
          <Ionicons name="checkmark" size={16} color={colors.onPrimary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  image: {
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  indicator: {
    height: 4,
    marginTop: -4,
    borderBottomLeftRadius: radii.md,
    borderBottomRightRadius: radii.md,
  },
  title: {
    ...typography.caption,
    color: colors.text,
    fontWeight: '600',
    marginTop: spacing.sm,
  },
  meta: {
    ...typography.label,
    color: colors.textSecondary,
    fontWeight: '500',
    marginTop: 2,
  },
  check: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  checkIdle: {
    backgroundColor: 'rgba(12, 16, 21, 0.55)',
    borderWidth: 1.5,
    borderColor: colors.text,
  },
  badge: {
    position: 'absolute',
    left: spacing.sm,
    bottom: spacing.sm + 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
    borderRadius: radii.full,
    backgroundColor: 'rgba(12, 16, 21, 0.82)',
  },
  badgeText: {
    ...typography.label,
    color: colors.text,
  },
  favorite: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
  quick: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.sm,
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
});
