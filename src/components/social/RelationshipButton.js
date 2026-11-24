import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { RELATIONSHIP } from '../../services/supabase/socialRules';
import { colors, radii, spacing, typography } from '../../theme';

export default function RelationshipButton({
  action = RELATIONSHIP.FOLLOW,
  loading = false,
  disabled = false,
  compact = false,
  onPress,
}) {
  const { t } = useTranslation();
  if (action === RELATIONSHIP.SELF) {
    return null;
  }

  const label = loading
    ? t('social.followSaving')
    : t(`social.actions.${action}`, { defaultValue: t('social.follow') });

  const followingLike = action === RELATIONSHIP.FOLLOWING || action === RELATIONSHIP.REQUESTED;
  const primary = action === RELATIONSHIP.FOLLOW
    || action === RELATIONSHIP.FOLLOW_BACK
    || action === RELATIONSHIP.ACCEPT;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, selected: followingLike }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        primary ? styles.primary : styles.secondary,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, primary ? styles.primaryLabel : styles.secondaryLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  compact: {
    minHeight: 36,
    minWidth: 84,
    paddingHorizontal: spacing.sm + 4,
  },
  primary: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  secondary: {
    backgroundColor: colors.surfaceElevated,
    borderColor: colors.border,
  },
  disabled: {
    opacity: 0.6,
  },
  pressed: {
    opacity: 0.88,
  },
  label: {
    ...typography.label,
    fontWeight: '700',
  },
  primaryLabel: {
    color: colors.onPrimary,
  },
  secondaryLabel: {
    color: colors.text,
  },
});
