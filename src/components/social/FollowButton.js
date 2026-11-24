import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function FollowButton({
  isFollowing = false,
  loading = false,
  disabled = false,
  compact = false,
  onPress,
}) {
  const { t } = useTranslation();
  const label = loading
    ? t('social.followSaving')
    : (isFollowing ? t('social.unfollow') : t('social.follow'));

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: disabled || loading, selected: isFollowing }}
      disabled={disabled || loading}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        compact && styles.compact,
        isFollowing ? styles.following : styles.follow,
        (disabled || loading) && styles.disabled,
        pressed && styles.pressed,
      ]}
    >
      <Text style={[styles.label, isFollowing ? styles.followingLabel : styles.followLabel]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    minHeight: 40,
    paddingHorizontal: spacing.md,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
  },
  compact: {
    minHeight: 36,
    paddingHorizontal: spacing.sm + 4,
  },
  follow: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  following: {
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
  followLabel: {
    color: colors.onPrimary,
  },
  followingLabel: {
    color: colors.text,
  },
});
