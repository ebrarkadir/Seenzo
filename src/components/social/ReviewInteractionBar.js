import { useEffect, useRef, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';

import ReviewLikeButton from './ReviewLikeButton';
import {
  likeReviewActivity,
  unlikeReviewActivity,
} from '../../services/supabase/socialInteractions';
import { colors, spacing, typography } from '../../theme';

/**
 * Like + open-discussion controls for eligible rating/review cards.
 * Optimistic like with rollback; in-flight lock prevents double-tap races.
 */
export default function ReviewInteractionBar({
  activityId,
  likedByViewer = false,
  likeCount = 0,
  commentCount = 0,
  demoMode = false,
  canReport = false,
  onReport,
  onOpenDiscussion,
  onInteractionChange,
}) {
  const { t } = useTranslation();
  const [liked, setLiked] = useState(Boolean(likedByViewer));
  const [count, setCount] = useState(Math.max(0, Number(likeCount) || 0));
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);

  useEffect(() => {
    if (inFlight.current) return;
    setLiked(Boolean(likedByViewer));
    setCount(Math.max(0, Number(likeCount) || 0));
  }, [activityId, likedByViewer, likeCount]);

  const guardDemo = () => {
    if (!demoMode) return false;
    Alert.alert(t('social.demoBlockedTitle'), t('social.demoBlockedBody'));
    return true;
  };

  const toggleLike = async () => {
    if (guardDemo() || inFlight.current || !activityId) return;
    inFlight.current = true;
    setBusy(true);
    const previousLiked = liked;
    const previousCount = count;
    const nextLiked = !previousLiked;
    const nextCount = Math.max(0, previousCount + (nextLiked ? 1 : -1));
    setLiked(nextLiked);
    setCount(nextCount);
    onInteractionChange?.({ liked: nextLiked, likeCount: nextCount });
    try {
      const result = nextLiked
        ? await likeReviewActivity(activityId)
        : await unlikeReviewActivity(activityId);
      if (result.unavailable) {
        setLiked(false);
        onInteractionChange?.({ liked: false, likeCount: previousCount, unavailable: true });
        return;
      }
      const serverCount = result.likeCount == null ? nextCount : result.likeCount;
      setLiked(Boolean(result.liked));
      setCount(serverCount);
      onInteractionChange?.({ liked: Boolean(result.liked), likeCount: serverCount });
    } catch (error) {
      setLiked(previousLiked);
      setCount(previousCount);
      onInteractionChange?.({ liked: previousLiked, likeCount: previousCount });
      Alert.alert(
        t('social.discussion.likeErrorTitle'),
        t(`social.errors.${error?.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  return (
    <View style={styles.bar}>
      <ReviewLikeButton
        liked={liked}
        likeCount={count}
        busy={busy}
        onPress={toggleLike}
      />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={t('social.discussion.openA11y', {
          count: Math.max(0, Number(commentCount) || 0),
        })}
        onPress={() => onOpenDiscussion?.()}
        hitSlop={8}
        style={({ pressed }) => [styles.commentHit, pressed && styles.pressed]}
      >
        <Ionicons name="chatbubble-outline" size={18} color={colors.textSecondary} />
        <Text style={styles.commentCount}>
          {Math.max(0, Number(commentCount) || 0)}
        </Text>
      </Pressable>
      {canReport && onReport ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={t('social.report.action')}
          onPress={() => {
            if (guardDemo()) return;
            onReport();
          }}
          hitSlop={8}
          style={({ pressed }) => [styles.commentHit, pressed && styles.pressed]}
        >
          <Text style={styles.reportLabel}>{t('social.report.action')}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    paddingTop: spacing.xs,
  },
  commentHit: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: 4,
  },
  pressed: {
    opacity: 0.88,
  },
  commentCount: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textSecondary,
  },
  reportLabel: {
    ...typography.caption,
    fontWeight: '600',
    color: colors.textMuted,
  },
});
