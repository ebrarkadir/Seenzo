import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import Artwork from '../../services/artwork/Artwork';
import { colors, radii, spacing, typography } from '../../theme';
import BookmarkButton from './BookmarkButton';

export function posterSize(windowWidth) {
  const gap = spacing.sm + 4;
  const width = Math.floor((windowWidth - spacing.md * 2 - gap) / 2);
  return { width, height: Math.round(width * 1.5), gap };
}

export default function PosterTile({
  uri,
  posterPath,
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
  watchlisted,
  onBookmark,
  bookmarkLabel,
  bottomOverlay = null,
}) {
  return (
    <View style={{ width }}>
      <View style={[styles.posterFrame, { width, height }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel || title}
          accessibilityState={accessibilityState}
          onPress={onPress}
          style={styles.posterPress}
        >
          <Artwork uri={uri} posterPath={posterPath} width={width} height={height} />
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
        </Pressable>
        {bottomOverlay ? (
          <View pointerEvents="box-none" style={styles.bottomOverlaySlot}>
            {bottomOverlay}
          </View>
        ) : null}
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityState={accessibilityState}
        onPress={onPress}
      >
        <Text style={styles.title} numberOfLines={2}>
          {title}
        </Text>
        {meta ? (
          <Text style={styles.meta} numberOfLines={1}>
            {meta}
          </Text>
        ) : null}
      </Pressable>
      {onBookmark ? (
        <BookmarkButton active={watchlisted} label={bookmarkLabel} onPress={onBookmark} style={styles.bookmark} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  posterFrame: {
    position: 'relative',
    overflow: 'hidden',
    borderRadius: radii.md,
    backgroundColor: colors.surfaceElevated,
  },
  posterPress: {
    width: '100%',
    height: '100%',
  },
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
  bottomOverlaySlot: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  bookmark: {
    position: 'absolute',
    top: spacing.sm,
    right: spacing.sm,
  },
});
