import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../../theme';

/**
 * Section header for the friends activity feed.
 * Kept separate so Phase 2 can add filters / sort without rewriting the Social screen.
 */
export default function ActivityFeedHeader({ title, subtitle }) {
  if (!title && !subtitle) {
    return null;
  }

  return (
    <View style={styles.wrap}>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    gap: 4,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
