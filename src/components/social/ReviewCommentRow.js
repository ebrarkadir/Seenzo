import { Alert, Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import CommentSpoilerBlock from './CommentSpoilerBlock';
import { colors, radii, spacing, typography } from '../../theme';

export default function ReviewCommentRow({
  item,
  indented = false,
  onReply,
  onDelete,
  onReport,
  onPressAuthor,
  actionBusy = false,
}) {
  const { t } = useTranslation();
  const name = item?.author?.displayName || item?.author?.username || t('social.unknownUser');
  const handle = item?.author?.username ? `@${item.author.username}` : '';
  const replyToHandle = item?.replyToAuthorUsername
    ? `@${item.replyToAuthorUsername}`
    : (item?.replyToAuthorDisplayName || null);

  const confirmDelete = () => {
    Alert.alert(
      t('social.discussion.deleteTitle'),
      t('social.discussion.deleteBody'),
      [
        { text: t('common.cancel'), style: 'cancel' },
        {
          text: t('social.discussion.deleteConfirm'),
          style: 'destructive',
          onPress: () => onDelete?.(item),
        },
      ]
    );
  };

  const openReport = () => {
    onReport?.(item);
  };

  return (
    <View style={[styles.row, indented && styles.indented]}>
      <Pressable onPress={() => onPressAuthor?.(item)} accessibilityRole="button">
        {item?.author?.avatarUrl ? (
          <Image source={{ uri: item.author.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={14} color={colors.primary} />
          </View>
        )}
      </Pressable>
      <View style={styles.copy}>
        <View style={styles.meta}>
          <Text style={styles.name} numberOfLines={1}>{name}</Text>
          {handle ? <Text style={styles.handle} numberOfLines={1}>{handle}</Text> : null}
          {item?.relativeTime ? (
            <Text style={styles.time}>{item.relativeTime}</Text>
          ) : null}
        </View>
        {replyToHandle ? (
          <Text style={styles.replyTo} numberOfLines={1}>
            {t('social.discussion.replyingToInline', { user: replyToHandle })}
          </Text>
        ) : null}
        <CommentSpoilerBlock
          resetKey={item?.id}
          text={item?.commentText}
          containsSpoilers={Boolean(item?.containsSpoilers)}
        />
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.discussion.replyA11y')}
            disabled={actionBusy}
            onPress={() => onReply?.(item)}
            hitSlop={8}
          >
            <Text style={styles.action}>{t('social.discussion.reply')}</Text>
          </Pressable>
          {item?.canDelete ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('social.discussion.deleteA11y')}
              disabled={actionBusy}
              onPress={confirmDelete}
              hitSlop={8}
            >
              <Text style={styles.actionMuted}>{t('social.discussion.delete')}</Text>
            </Pressable>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('social.discussion.reportA11y')}
              disabled={actionBusy}
              onPress={openReport}
              hitSlop={8}
            >
              <Text style={styles.actionMuted}>{t('social.discussion.report')}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  indented: {
    marginLeft: spacing.xl,
    paddingLeft: spacing.sm,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: colors.border,
  },
  avatar: {
    width: 32,
    height: 32,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: 32,
    height: 32,
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
    gap: 4,
  },
  meta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 6,
  },
  name: {
    ...typography.caption,
    fontWeight: '700',
    color: colors.text,
  },
  handle: {
    ...typography.label,
    color: colors.textMuted,
  },
  time: {
    ...typography.label,
    color: colors.textMuted,
  },
  replyTo: {
    ...typography.label,
    color: colors.primary,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.md,
    marginTop: 2,
  },
  action: {
    ...typography.label,
    color: colors.primary,
  },
  actionMuted: {
    ...typography.label,
    color: colors.textMuted,
  },
});
