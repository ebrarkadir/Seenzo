import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, radii, spacing, typography } from '../../theme';

export default function UserSearchResult({ profile, onPress }) {
  const displayName = profile?.displayName || profile?.username || '';
  const username = profile?.username ? `@${profile.username}` : '';

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${displayName} ${username}`.trim()}
      onPress={() => onPress?.(profile)}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {profile?.avatarUrl ? (
        <Image source={{ uri: profile.avatarUrl }} style={styles.avatar} />
      ) : (
        <View style={styles.avatarFallback}>
          <Ionicons name="person" size={20} color={colors.primary} />
        </View>
      )}
      <View style={styles.copy}>
        <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
        <Text style={styles.username} numberOfLines={1}>{username}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pressed: {
    backgroundColor: colors.surfaceElevated,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.surface,
  },
  avatarFallback: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
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
  name: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
  },
  username: {
    ...typography.caption,
    color: colors.textSecondary,
  },
});
