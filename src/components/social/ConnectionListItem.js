import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import RelationshipButton from './RelationshipButton';
import { colors, radii, spacing, typography } from '../../theme';

export default function ConnectionListItem({
  item,
  onPress,
  onAction,
  actionLoading = false,
}) {
  const displayName = item?.displayName || item?.username || '';
  const username = item?.username ? `@${item.username}` : '';
  const badge = item?.relationship?.followsYou && !item?.relationship?.isFollowing
    ? 'follows_you'
    : null;

  return (
    <View style={styles.row}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${displayName} ${username}`.trim()}
        onPress={() => onPress?.(item)}
        style={({ pressed }) => [styles.identity, pressed && styles.pressed]}
      >
        {item?.avatarUrl ? (
          <Image source={{ uri: item.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={20} color={colors.primary} />
          </View>
        )}
        <View style={styles.copy}>
          <Text style={styles.name} numberOfLines={1}>{displayName}</Text>
          <Text style={styles.username} numberOfLines={1}>{username}</Text>
          {badge ? (
            <Text style={styles.badge}>Follows you</Text>
          ) : null}
        </View>
      </Pressable>
      {item?.action ? (
        <RelationshipButton
          compact
          action={item.action}
          loading={actionLoading}
          onPress={() => onAction?.(item)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    minHeight: 72,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  identity: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  pressed: {
    opacity: 0.88,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: 48,
    height: 48,
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
    fontWeight: '700',
    color: colors.text,
  },
  username: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  badge: {
    ...typography.label,
    color: colors.primary,
    marginTop: 2,
  },
});
