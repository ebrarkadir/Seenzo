import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

const spoilerOn = {
  surface: 'rgba(232, 189, 100, 0.12)',
  border: 'rgba(232, 189, 100, 0.45)',
  icon: '#E8BD64',
};

/**
 * Compact spoiler mark for comment/reply composer (not a checkbox).
 */
export default function CommentSpoilerToggle({
  value = false,
  disabled = false,
  onChange,
}) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityState={{ checked: Boolean(value), disabled }}
      accessibilityLabel={t('social.discussion.spoilerToggleA11y')}
      disabled={disabled}
      onPress={() => {
        if (disabled || typeof onChange !== 'function') return;
        onChange(!value);
      }}
      hitSlop={6}
      style={({ pressed }) => [
        styles.chip,
        value && styles.chipOn,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.iconWrap, value && styles.iconWrapOn]}>
        <Ionicons
          name={value ? 'eye-off' : 'eye'}
          size={14}
          color={value ? spoilerOn.icon : colors.textMuted}
        />
      </View>
      <Text style={[styles.label, value && styles.labelOn]}>
        {t('social.discussion.spoilerMark')}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 6,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.full,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surfaceElevated,
  },
  chipOn: {
    borderColor: spoilerOn.border,
    backgroundColor: spoilerOn.surface,
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.5,
  },
  iconWrap: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconWrapOn: {
    backgroundColor: 'rgba(232, 189, 100, 0.18)',
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  labelOn: {
    color: spoilerOn.icon,
  },
});
