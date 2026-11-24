import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import RelationshipButton from './RelationshipButton';
import { formatRelativeTime, RELATIONSHIP } from '../../services/supabase/socialRules';
import { colors, radii, spacing, typography } from '../../theme';

export default function NotificationRow({
  item,
  onPressActor,
  onAccept,
  onReject,
  onFollowBack,
  actionLoading = false,
}) {
  const { t } = useTranslation();
  const username = item?.actor?.username ? `@${item.actor.username}` : '';
  const body = t(`social.notifications.types.${item?.type}`, {
    user: username || item?.actor?.displayName || t('social.notifications.someone'),
    defaultValue: t('social.notifications.types.generic', { user: username }),
  });

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => onPressActor?.(item)}
      style={({ pressed }) => [
        styles.row,
        item?.unread && styles.unread,
        pressed && styles.pressed,
      ]}
    >
      <View style={styles.avatarWrap}>
        {item?.actor?.avatarUrl ? (
          <Image source={{ uri: item.actor.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={18} color={colors.primary} />
          </View>
        )}
        {item?.unread ? <View style={styles.dot} /> : null}
      </View>
      <View style={styles.copy}>
        <Text style={styles.body}>{body}</Text>
        <Text style={styles.time}>{formatRelativeTime(item?.createdAt)}</Text>
        {item?.type === 'follow_request' ? (
          <View style={styles.actions}>
            <RelationshipButton
              compact
              action={RELATIONSHIP.ACCEPT}
              loading={actionLoading}
              onPress={() => onAccept?.(item)}
            />
            <Pressable
              accessibilityRole="button"
              onPress={() => onReject?.(item)}
              style={styles.reject}
            >
              <Text style={styles.rejectLabel}>{t('social.actions.reject')}</Text>
            </Pressable>
          </View>
        ) : null}
        {item?.type === 'new_follower' || item?.type === 'follow_request_accepted' ? (
          <View style={styles.actions}>
            <RelationshipButton
              compact
              action={RELATIONSHIP.FOLLOW_BACK}
              loading={actionLoading}
              onPress={() => onFollowBack?.(item)}
            />
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  unread: {
    borderColor: colors.primary,
    backgroundColor: colors.surfaceElevated,
  },
  pressed: {
    opacity: 0.9,
  },
  avatarWrap: {
    position: 'relative',
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
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
  dot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
    borderWidth: 2,
    borderColor: colors.surfaceElevated,
  },
  copy: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  body: {
    ...typography.body,
    color: colors.text,
  },
  time: {
    ...typography.caption,
    color: colors.textMuted,
  },
  actions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: spacing.sm,
    alignItems: 'center',
  },
  reject: {
    minHeight: 36,
    paddingHorizontal: spacing.md,
    justifyContent: 'center',
  },
  rejectLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
});
