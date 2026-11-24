import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import { colors, spacing, typography } from '../../theme';

export default function FollowingAccountsStrip({
  items = [],
  onPressAccount,
  onSeeAll,
  loading = false,
}) {
  const { t } = useTranslation();
  if (!loading && (!items || items.length === 0)) {
    return null;
  }

  return (
    <View style={styles.wrap} accessibilityRole="summary">
      <View style={styles.headerRow}>
        <Text style={styles.title}>{t('social.sectionFollowing')}</Text>
        {onSeeAll ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.seeAllFollowingA11y')}
            hitSlop={8}
            onPress={onSeeAll}
            style={({ pressed }) => [styles.seeAllHit, pressed && styles.pressed]}
          >
            <Text style={styles.seeAll}>{t('social.seeAllFollowing')}</Text>
          </Pressable>
        ) : null}
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        {items.map((item) => {
          const label = item?.username
            ? `@${item.username}`
            : (item?.displayName || t('social.unknownUser'));
          return (
            <Pressable
              key={item.userId}
              accessibilityRole="button"
              accessibilityLabel={label}
              onPress={() => onPressAccount?.(item)}
              style={({ pressed }) => [styles.account, pressed && styles.pressed]}
            >
              {item?.avatarUrl ? (
                <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
              ) : (
                <View style={styles.avatarFallback}>
                  <Ionicons name="person" size={22} color={colors.primary} />
                </View>
              )}
              <Text style={styles.username} numberOfLines={1}>{label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    gap: spacing.sm,
  },
  title: {
    ...typography.label,
    color: colors.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  seeAllHit: {
    paddingVertical: 4,
    paddingHorizontal: 2,
  },
  seeAll: {
    ...typography.label,
    color: colors.primary,
  },
  row: {
    paddingHorizontal: spacing.md,
    gap: spacing.md,
  },
  account: {
    width: 76,
    alignItems: 'center',
    gap: 6,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  username: {
    ...typography.caption,
    color: colors.textSecondary,
    textAlign: 'center',
    width: '100%',
  },
  pressed: {
    opacity: 0.88,
  },
});
