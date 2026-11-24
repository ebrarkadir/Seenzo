import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import PrimaryButton from '../ui/PrimaryButton';
import { colors, radii, spacing, typography } from '../../theme';

export default function ActivityFeedEmptyState({
  title,
  description,
  primaryLabel,
  onPrimary,
  compact = false,
}) {
  return (
    <View
      style={[styles.wrap, compact ? styles.wrapCompact : styles.wrapFill]}
      accessibilityRole="summary"
    >
      <View style={styles.iconBadge}>
        <Ionicons name="people-outline" size={28} color={colors.primary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.description}>{description}</Text>
      {primaryLabel ? (
        <View style={styles.buttonSlot}>
          <PrimaryButton
            label={primaryLabel}
            onPress={onPrimary}
            style={styles.button}
            accessibilityLabel={primaryLabel}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
    width: '100%',
  },
  wrapFill: {
    flexGrow: 1,
    paddingVertical: spacing.xxl,
  },
  wrapCompact: {
    paddingVertical: spacing.lg,
  },
  iconBadge: {
    width: 64,
    height: 64,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.sm,
  },
  title: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  description: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    marginBottom: spacing.md,
  },
  buttonSlot: {
    width: '100%',
    maxWidth: 280,
    alignItems: 'stretch',
  },
  button: {
    alignSelf: 'stretch',
    width: '100%',
  },
});
