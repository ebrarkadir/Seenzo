import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { router, Stack, useLocalSearchParams } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';

import CommentSpoilerToggle from '../../components/social/CommentSpoilerToggle';
import ReportSheet from '../../components/social/ReportSheet';
import ReviewCommentRow from '../../components/social/ReviewCommentRow';
import ReviewLikeButton from '../../components/social/ReviewLikeButton';
import SpoilerReviewBlock from '../../components/social/SpoilerReviewBlock';
import PrimaryButton from '../../components/ui/PrimaryButton';
import { useAuth } from '../../auth/AuthContext';
import { useTracking } from '../../tracking/TrackingContext';
import {
  describeActivityAction,
  formatActivityRating,
} from '../../services/supabase/activityFeedPresentation';
import {
  canSubmitComment,
  clampCommentText,
  createReviewComment,
  deleteReviewComment,
  getReviewInteractionSummary,
  isSocialV4UnavailableError,
  likeReviewActivity,
  listReviewComments,
  REPORT_TARGET,
  reportSocialContent,
  SOCIAL_COMMENT_MAX_LENGTH,
  SOCIAL_COMMENTS_PAGE_SIZE,
  unlikeReviewActivity,
} from '../../services/supabase/socialInteractions';
import { colors, radii, spacing, typography } from '../../theme';

export default function ReviewDiscussionScreen() {
  const { session } = useAuth();
  const params = useLocalSearchParams();
  const activityId = String(params.activityId || '').trim();

  useEffect(() => {
    if (!session?.user?.id) {
      router.replace('/sign-in');
    }
  }, [session?.user?.id]);

  if (!session?.user?.id) {
    return null;
  }

  return (
    <DiscussionBody
      key={`${session.user.id}:${activityId}`}
      activityId={activityId}
    />
  );
}

function nestComments(items) {
  const roots = [];
  const byParent = new Map();
  for (const item of items) {
    if (item.parentCommentId) {
      const list = byParent.get(item.parentCommentId) || [];
      list.push(item);
      byParent.set(item.parentCommentId, list);
    } else {
      roots.push(item);
    }
  }
  const rows = [];
  for (const root of roots) {
    rows.push({ kind: 'comment', item: root, indented: false });
    const replies = byParent.get(root.id) || [];
    for (const reply of replies) {
      rows.push({ kind: 'comment', item: reply, indented: true });
    }
  }
  // Orphan replies (deleted parent) still show, indented.
  for (const [parentId, replies] of byParent.entries()) {
    if (roots.some((root) => root.id === parentId)) continue;
    for (const reply of replies) {
      rows.push({ kind: 'comment', item: reply, indented: true });
    }
  }
  return rows;
}

function DiscussionBody({ activityId }) {
  const { t } = useTranslation();
  const { demoMode } = useTracking();
  const insets = useSafeAreaInsets();
  const [summary, setSummary] = useState(null);
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(null);
  const [unavailable, setUnavailable] = useState(false);
  const [v4Unavailable, setV4Unavailable] = useState(false);
  const [draft, setDraft] = useState('');
  const [spoilers, setSpoilers] = useState(false);
  const [replyTo, setReplyTo] = useState(null);
  const [sending, setSending] = useState(false);
  const [likeBusy, setLikeBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [reportTarget, setReportTarget] = useState(null);
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const cursorRef = useRef({ createdAt: null, id: null });
  const requestSeq = useRef(0);
  const sendLock = useRef(false);
  const likeLock = useRef(false);

  const loadSummary = useCallback(async () => {
    if (!activityId) {
      setUnavailable(true);
      return null;
    }
    const next = await getReviewInteractionSummary(activityId);
    setSummary(next);
    setUnavailable(false);
    return next;
  }, [activityId]);

  const loadComments = useCallback(async ({ reset = false } = {}) => {
    const result = await listReviewComments({
      activityId,
      limit: SOCIAL_COMMENTS_PAGE_SIZE,
      cursorCreatedAt: reset ? null : cursorRef.current.createdAt,
      cursorId: reset ? null : cursorRef.current.id,
    });
    setComments((current) => (reset ? result.items : [...current, ...result.items]));
    cursorRef.current = {
      createdAt: result.cursorCreatedAt,
      id: result.cursorId,
    };
    setHasMore(result.hasMore);
    return result;
  }, [activityId]);

  const bootstrap = useCallback(async ({ soft = false } = {}) => {
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (soft) setRefreshing(true);
    else setLoading(true);
    try {
      await loadSummary();
      if (requestSeq.current !== seq) return;
      cursorRef.current = { createdAt: null, id: null };
      await loadComments({ reset: true });
      if (requestSeq.current !== seq) return;
      setError(null);
      setV4Unavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (isSocialV4UnavailableError(requestError)) {
        setV4Unavailable(true);
        setError(null);
      } else if (requestError?.code === 'activity_unavailable') {
        setUnavailable(true);
        setSummary(null);
        setComments([]);
        setError(null);
      } else {
        setError(requestError);
      }
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setRefreshing(false);
        setLoadingMore(false);
      }
    }
  }, [loadComments, loadSummary]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        if (!activityId) {
          if (!cancelled) setUnavailable(true);
          return;
        }
        const next = await getReviewInteractionSummary(activityId);
        if (cancelled) return;
        setSummary(next);
        setUnavailable(false);
        cursorRef.current = { createdAt: null, id: null };
        const result = await listReviewComments({
          activityId,
          limit: SOCIAL_COMMENTS_PAGE_SIZE,
        });
        if (cancelled) return;
        setComments(result.items);
        cursorRef.current = {
          createdAt: result.cursorCreatedAt,
          id: result.cursorId,
        };
        setHasMore(result.hasMore);
        setError(null);
        setV4Unavailable(false);
      } catch (requestError) {
        if (cancelled) return;
        if (isSocialV4UnavailableError(requestError)) {
          setV4Unavailable(true);
          setError(null);
        } else if (requestError?.code === 'activity_unavailable') {
          setUnavailable(true);
          setSummary(null);
          setComments([]);
          setError(null);
        } else {
          setError(requestError);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          setRefreshing(false);
          setLoadingMore(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activityId]);

  const guardDemo = () => {
    if (!demoMode) return false;
    Alert.alert(t('social.demoBlockedTitle'), t('social.demoBlockedBody'));
    return true;
  };

  const onToggleLike = async () => {
    if (guardDemo() || likeLock.current || !summary?.id) return;
    if (summary.isOwner) {
      Alert.alert(
        t('social.discussion.likeErrorTitle'),
        t('social.errors.cannot_like_own')
      );
      return;
    }
    likeLock.current = true;
    setLikeBusy(true);
    const previous = summary;
    const nextLiked = !previous.likedByViewer;
    const nextCount = Math.max(0, previous.likeCount + (nextLiked ? 1 : -1));
    setSummary({ ...previous, likedByViewer: nextLiked, likeCount: nextCount });
    try {
      const result = nextLiked
        ? await likeReviewActivity(previous.id)
        : await unlikeReviewActivity(previous.id);
      if (result.unavailable) {
        setUnavailable(true);
        return;
      }
      setSummary((current) => ({
        ...current,
        likedByViewer: Boolean(result.liked),
        likeCount: result.likeCount == null ? nextCount : result.likeCount,
      }));
    } catch (requestError) {
      setSummary(previous);
      Alert.alert(
        t('social.discussion.likeErrorTitle'),
        t(`social.errors.${requestError?.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      likeLock.current = false;
      setLikeBusy(false);
    }
  };

  const onSend = async () => {
    if (guardDemo() || sendLock.current || !canSubmitComment(draft) || !activityId) return;
    sendLock.current = true;
    setSending(true);
    const target = replyTo;
    try {
      const created = await createReviewComment({
        activityId,
        commentText: draft,
        containsSpoilers: spoilers,
        // Clicked target (root or reply); RPC flattens parent_comment_id to thread root.
        parentCommentId: target?.id || null,
      });
      const withReplyLabel = created.replyToCommentId && target?.id === created.replyToCommentId
        ? {
          ...created,
          replyToAuthorUsername: target.author?.username || created.replyToAuthorUsername || null,
          replyToAuthorDisplayName:
            target.author?.displayName || created.replyToAuthorDisplayName || null,
        }
        : created;
      setComments((current) => [...current, withReplyLabel]);
      setSummary((current) => (
        current
          ? { ...current, commentCount: (current.commentCount || 0) + 1 }
          : current
      ));
      setDraft('');
      setSpoilers(false);
      setReplyTo(null);
    } catch (requestError) {
      Alert.alert(
        t('social.discussion.commentErrorTitle'),
        t(`social.errors.${requestError?.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      sendLock.current = false;
      setSending(false);
    }
  };

  const onDelete = async (item) => {
    if (guardDemo() || !item?.id || actionBusy) return;
    const removedEstimate = 1 + comments.filter((row) => row.parentCommentId === item.id).length;
    setActionBusy(true);
    try {
      await deleteReviewComment(item.id);
      setComments((current) => current
        .filter((row) => row.id !== item.id && row.parentCommentId !== item.id)
        .map((row) => (
          row.replyToCommentId === item.id
            ? {
              ...row,
              replyToCommentId: null,
              replyToAuthorUsername: null,
              replyToAuthorDisplayName: null,
            }
            : row
        )));
      setReplyTo((current) => {
        if (!current) return null;
        if (current.id === item.id || current.parentCommentId === item.id) return null;
        return current;
      });
      try {
        const next = await getReviewInteractionSummary(activityId);
        if (next) {
          setSummary(next);
        } else {
          setSummary((current) => (
            current
              ? {
                ...current,
                commentCount: Math.max(0, (current.commentCount || 0) - removedEstimate),
              }
              : current
          ));
        }
      } catch {
        setSummary((current) => (
          current
            ? {
              ...current,
              commentCount: Math.max(0, (current.commentCount || 0) - removedEstimate),
            }
            : current
        ));
      }
    } catch (requestError) {
      Alert.alert(
        t('social.discussion.commentErrorTitle'),
        t(`social.errors.${requestError?.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setActionBusy(false);
    }
  };

  const onReport = (item) => {
    if (guardDemo() || !item?.id) return;
    setReportTarget(item);
  };

  const submitCommentReport = async (reason) => {
    if (!reportTarget?.id || reportSubmitting) return;
    setReportSubmitting(true);
    try {
      await reportSocialContent({
        targetType: REPORT_TARGET.REVIEW_COMMENT,
        targetId: reportTarget.id,
        reason,
      });
      setReportTarget(null);
      Alert.alert(t('social.report.thanksTitle'), t('social.report.thanksBody'));
    } catch (requestError) {
      Alert.alert(
        t('social.report.errorTitle'),
        t(`social.errors.${requestError?.code}`, { defaultValue: t('social.errors.generic') })
      );
    } finally {
      setReportSubmitting(false);
    }
  };

  const rows = useMemo(() => nestComments(comments), [comments]);
  const canSend = canSubmitComment(draft) && !sending;

  if (loading) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: t('social.discussion.title') }} />
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (v4Unavailable) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: t('social.discussion.title') }} />
        <Text style={styles.emptyTitle}>{t('social.discussion.unavailableTitle')}</Text>
        <Text style={styles.emptyBody}>{t('social.discussion.unavailableBody')}</Text>
      </View>
    );
  }

  if (unavailable) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: t('social.discussion.title') }} />
        <Text style={styles.emptyTitle}>{t('social.discussion.goneTitle')}</Text>
        <Text style={styles.emptyBody}>{t('social.discussion.goneBody')}</Text>
        <PrimaryButton
          label={t('common.back')}
          onPress={() => router.back()}
          style={styles.retryButton}
        />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: t('social.discussion.title') }} />
        <Text style={styles.emptyTitle}>{t('social.discussion.loadErrorTitle')}</Text>
        <Text style={styles.emptyBody}>
          {t(`social.errors.${error?.code}`, { defaultValue: t('social.errors.generic') })}
        </Text>
        <PrimaryButton
          label={t('common.retry')}
          onPress={() => bootstrap()}
          style={styles.retryButton}
        />
      </View>
    );
  }

  const header = (
    <View style={styles.headerCard}>
      <Pressable
        style={styles.userRow}
        onPress={() => {
          if (summary?.actor?.username) {
            router.push(`/user/${encodeURIComponent(summary.actor.username)}`);
          }
        }}
      >
        {summary?.actor?.avatarUrl ? (
          <Image source={{ uri: summary.actor.avatarUrl }} style={styles.avatar} />
        ) : (
          <View style={styles.avatarFallback}>
            <Ionicons name="person" size={18} color={colors.primary} />
          </View>
        )}
        <View style={styles.userCopy}>
          <Text style={styles.name} numberOfLines={1}>
            {summary?.actor?.displayName || summary?.actor?.username || ''}
          </Text>
          <Text style={styles.action} numberOfLines={2}>
            {describeActivityAction(t, summary)}
            {summary?.relativeTime ? ` · ${summary.relativeTime}` : ''}
          </Text>
        </View>
      </Pressable>
      {formatActivityRating(summary?.rating) ? (
        <Text style={styles.rating}>{formatActivityRating(summary.rating)}</Text>
      ) : null}
      <SpoilerReviewBlock
        resetKey={summary?.id}
        reviewText={summary?.reviewText}
        containsSpoilers={Boolean(summary?.reviewContainsSpoilers)}
      />
      <View style={styles.likeRow}>
        <ReviewLikeButton
          liked={Boolean(summary?.likedByViewer)}
          likeCount={summary?.likeCount || 0}
          busy={likeBusy}
          disabled={Boolean(summary?.isOwner)}
          onPress={onToggleLike}
        />
        <Text style={styles.commentMeta}>
          {t('social.discussion.commentCount', {
            count: summary?.commentCount || 0,
          })}
        </Text>
      </View>
    </View>
  );

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
    >
      <Stack.Screen options={{ title: t('social.discussion.title') }} />
      <FlatList
        data={rows}
        keyExtractor={(row) => row.item.id}
        contentContainerStyle={styles.listContent}
        refreshControl={(
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => bootstrap({ soft: true })}
            tintColor={colors.primary}
          />
        )}
        ListHeaderComponent={header}
        ListEmptyComponent={(
          <View style={styles.emptyComments}>
            <Text style={styles.emptyTitle}>{t('social.discussion.emptyTitle')}</Text>
            <Text style={styles.emptyBody}>{t('social.discussion.emptyBody')}</Text>
          </View>
        )}
        renderItem={({ item: row }) => (
          <ReviewCommentRow
            item={row.item}
            indented={row.indented}
            actionBusy={actionBusy}
            onReply={(target) => setReplyTo(target)}
            onDelete={onDelete}
            onReport={onReport}
            onPressAuthor={(target) => {
              if (target?.author?.username) {
                router.push(`/user/${encodeURIComponent(target.author.username)}`);
              }
            }}
          />
        )}
        onEndReached={() => {
          if (!hasMore || loadingMore || refreshing) return;
          setLoadingMore(true);
          loadComments({ reset: false })
            .catch(() => {})
            .finally(() => setLoadingMore(false));
        }}
        onEndReachedThreshold={0.4}
        ListFooterComponent={loadingMore ? (
          <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.md }} />
        ) : null}
      />

      <View style={[styles.composer, { paddingBottom: Math.max(insets.bottom, spacing.sm) }]}>
        {replyTo ? (
          <View style={styles.replyBanner}>
            <Text style={styles.replyText} numberOfLines={1}>
              {t('social.discussion.replyingTo', {
                user: replyTo.author?.username
                  ? `@${replyTo.author.username}`
                  : (replyTo.author?.displayName || ''),
              })}
            </Text>
            <Pressable onPress={() => setReplyTo(null)} hitSlop={8}>
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
        ) : null}
        <View style={styles.composerRow}>
          <TextInput
            value={draft}
            onChangeText={(value) => setDraft(clampCommentText(value))}
            placeholder={t('social.discussion.placeholder')}
            placeholderTextColor={colors.textMuted}
            style={styles.input}
            multiline
            maxLength={SOCIAL_COMMENT_MAX_LENGTH}
            editable={!sending}
          />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t('social.discussion.sendA11y')}
            disabled={!canSend}
            onPress={onSend}
            style={({ pressed }) => [
              styles.send,
              !canSend && styles.sendDisabled,
              pressed && canSend && styles.pressed,
            ]}
          >
            {sending ? (
              <ActivityIndicator color={colors.onPrimary} size="small" />
            ) : (
              <Ionicons name="send" size={18} color={colors.onPrimary} />
            )}
          </Pressable>
        </View>
        <View style={styles.composerMeta}>
          <CommentSpoilerToggle
            value={spoilers}
            disabled={sending}
            onChange={setSpoilers}
          />
          <Text style={styles.counter}>
            {`${draft.trim().length}/${SOCIAL_COMMENT_MAX_LENGTH}`}
          </Text>
        </View>
      </View>
      <ReportSheet
        visible={Boolean(reportTarget)}
        targetKind="comment"
        submitting={reportSubmitting}
        onClose={() => {
          if (!reportSubmitting) setReportTarget(null);
        }}
        onSubmit={submitCommentReport}
      />
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
    backgroundColor: colors.background,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
    backgroundColor: colors.background,
    gap: spacing.sm,
  },
  listContent: {
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.lg,
  },
  headerCard: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  userRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: 40,
    height: 40,
    borderRadius: radii.full,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
  },
  userCopy: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  name: {
    ...typography.body,
    fontWeight: '700',
    color: colors.text,
  },
  action: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  rating: {
    ...typography.label,
    color: colors.primary,
  },
  likeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.lg,
    marginTop: spacing.xs,
  },
  commentMeta: {
    ...typography.caption,
    color: colors.textMuted,
  },
  emptyComments: {
    paddingVertical: spacing.xl,
    alignItems: 'center',
    gap: spacing.xs,
  },
  emptyTitle: {
    ...typography.subtitle,
    color: colors.text,
    textAlign: 'center',
  },
  emptyBody: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: spacing.md,
    alignSelf: 'center',
  },
  composer: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    gap: spacing.sm,
  },
  replyBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  replyText: {
    ...typography.caption,
    color: colors.primary,
    flex: 1,
  },
  composerRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
  },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
    borderRadius: radii.lg,
    backgroundColor: colors.surfaceElevated,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    ...typography.body,
  },
  send: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
  },
  sendDisabled: {
    opacity: 0.4,
  },
  pressed: {
    opacity: 0.9,
  },
  composerMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  counter: {
    ...typography.label,
    color: colors.textMuted,
  },
});
