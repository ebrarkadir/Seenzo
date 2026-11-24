import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';

import { colors, radii, spacing, typography } from '../../theme';

export default function FollowCountsRow({
  followers = 0,
  following = 0,
  onPressFollowers,
  onPressFollowing,
}) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${followers} ${t('social.followers')}`}
        onPress={onPressFollowers}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <Text style={styles.value}>{followers}</Text>
        <Text style={styles.label}>{t('social.followers')}</Text>
      </Pressable>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${following} ${t('social.followingCount')}`}
        onPress={onPressFollowing}
        style={({ pressed }) => [styles.card, pressed && styles.pressed]}
      >
        <Text style={styles.value}>{following}</Text>
        <Text style={styles.label}>{t('social.followingCount')}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
  },
  card: {
    flex: 1,
    gap: 2,
    padding: spacing.sm,
    borderRadius: radii.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pressed: {
    opacity: 0.88,
  },
  value: {
    ...typography.subtitle,
    color: colors.text,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
