import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function FindPeopleRow({ onPress }) {
  const { t } = useTranslation();

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('social.findPeopleA11y')}
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      <View style={styles.iconBadge}>
        <Ionicons name="people-outline" size={18} color={colors.primary} />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{t('social.findPeople')}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>
          {t('social.findPeopleSubtitle')}
        </Text>
      </View>
      <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    marginHorizontal: spacing.md,
    minHeight: 56,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.88,
  },
  iconBadge: {
    width: 36,
    height: 36,
    borderRadius: radii.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  title: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
  },
  subtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
