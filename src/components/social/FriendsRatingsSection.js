import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useTranslation } from 'react-i18next';

import SpoilerReviewBlock from './SpoilerReviewBlock';
import {
  FRIENDS_RATINGS_PAGE_SIZE,
  getFriendsMediaRatings,
  isSocialV5UnavailableError,
} from '../../services/supabase/socialV5';
import { colors, radii, spacing, typography } from '../../theme';

function formatAverage(value) {
  if (value == null || !Number.isFinite(Number(value))) return null;
  const num = Number(value);
  return Number.isInteger(num) ? String(num) : num.toFixed(1);
}

/**
 * Friends' Ratings block for movie/show detail.
 * Collapsed by default; keeps existing fetch lifecycle (no extra backend calls).
 * Does not replace Trakt or personal ratings.
 */
export default function FriendsRatingsSection({
  mediaType,
  mediaId,
  enabled = true,
}) {
  const { t } = useTranslation();
  const mediaKey = `${mediaType || ''}:${mediaId || ''}`;
  const [expanded, setExpanded] = useState(false);
  const [expandedMediaKey, setExpandedMediaKey] = useState(mediaKey);
  const [summary, setSummary] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [unavailable, setUnavailable] = useState(false);
  const [error, setError] = useState(null);
  const offsetRef = useRef(0);
  const requestSeq = useRef(0);

  // Collapse when navigating to a different title (same component instance).
  if (mediaKey !== expandedMediaKey) {
    setExpandedMediaKey(mediaKey);
    setExpanded(false);
  }

  const load = useCallback(async ({ reset = false } = {}) => {
    if (!enabled || !mediaType || !mediaId) {
      setSummary(null);
      setItems([]);
      setUnavailable(false);
      setError(null);
      setHasMore(false);
      setLoading(false);
      return;
    }
    const seq = requestSeq.current + 1;
    requestSeq.current = seq;
    if (reset) setLoading(true);
    else setLoadingMore(true);
    const nextOffset = reset ? 0 : offsetRef.current;
    try {
      const result = await getFriendsMediaRatings({
        mediaType,
        mediaId,
        limit: FRIENDS_RATINGS_PAGE_SIZE,
        offset: nextOffset,
      });
      if (requestSeq.current !== seq) return;
      setSummary({
        average: result.average,
        ratingCount: result.ratingCount,
      });
      setItems((current) => (reset ? result.items : [...current, ...result.items]));
      offsetRef.current = nextOffset + result.items.length;
      setHasMore(result.hasMore);
      setError(null);
      setUnavailable(false);
    } catch (requestError) {
      if (requestSeq.current !== seq) return;
      if (isSocialV5UnavailableError(requestError)) {
        setUnavailable(true);
        if (reset) {
          setSummary(null);
          setItems([]);
        }
        setError(null);
      } else {
        if (reset) {
          setSummary(null);
          setItems([]);
        }
        setError(requestError);
      }
      setHasMore(false);
    } finally {
      if (requestSeq.current === seq) {
        setLoading(false);
        setLoadingMore(false);
      }
    }
  }, [enabled, mediaId, mediaType]);

  useEffect(() => {
    let cancelled = false;
    offsetRef.current = 0;
    (async () => {
      if (!enabled || !mediaType || !mediaId) {
        if (!cancelled) {
          setSummary(null);
          setItems([]);
          setUnavailable(false);
          setError(null);
          setHasMore(false);
          setLoading(false);
        }
        return;
      }
      const seq = requestSeq.current + 1;
      requestSeq.current = seq;
      setLoading(true);
      try {
        const result = await getFriendsMediaRatings({
          mediaType,
          mediaId,
          limit: FRIENDS_RATINGS_PAGE_SIZE,
          offset: 0,
        });
        if (cancelled || requestSeq.current !== seq) return;
        setSummary({
          average: result.average,
          ratingCount: result.ratingCount,
        });
        setItems(result.items);
        offsetRef.current = result.items.length;
        setHasMore(result.hasMore);
        setError(null);
        setUnavailable(false);
      } catch (requestError) {
        if (cancelled || requestSeq.current !== seq) return;
        if (isSocialV5UnavailableError(requestError)) {
          setUnavailable(true);
          setSummary(null);
          setItems([]);
          setError(null);
        } else {
          setSummary(null);
          setItems([]);
          setError(requestError);
        }
        setHasMore(false);
      } finally {
        if (!cancelled && requestSeq.current === seq) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, mediaId, mediaType]);

  if (!enabled) {
    return null;
  }

  if (unavailable) {
    return null;
  }

  const friendCount = summary?.ratingCount;
  const title = friendCount != null && friendCount > 0
    ? t('social.friendsRatings.titleWithCount', { count: friendCount })
    : t('social.friendsRatings.title');

  return (
    <View style={styles.section}>
      <Pressable
        accessibilityRole="button"
        accessibilityState={{ expanded }}
        accessibilityLabel={
          expanded
            ? t('social.friendsRatings.collapseA11y')
            : t('social.friendsRatings.expandA11y')
        }
        onPress={() => setExpanded((value) => !value)}
        style={({ pressed }) => [styles.toggleRow, pressed && styles.pressed]}
      >
        <View style={styles.iconBadge}>
          <Ionicons name="people-outline" size={18} color={colors.primary} />
        </View>
        <View style={styles.copy}>
          <Text style={styles.toggleTitle} numberOfLines={1}>{title}</Text>
          <Text style={styles.toggleSubtitle} numberOfLines={1}>
            {friendCount != null && friendCount > 0
              ? t('social.friendsRatings.basedOn', { count: friendCount })
              : t('social.friendsRatings.subtitleHint')}
          </Text>
        </View>
        {loading && !expanded ? (
          <ActivityIndicator color={colors.primary} size="small" />
        ) : (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.textMuted}
          />
        )}
      </Pressable>

      {expanded ? (
        <View style={styles.body}>
          {loading ? (
            <View style={styles.centered}>
              <ActivityIndicator color={colors.primary} />
            </View>
          ) : null}

          {error && !loading ? (
            <Pressable onPress={() => load({ reset: true })} style={styles.centered}>
              <Text style={styles.empty}>
                {t(`social.errors.${error?.code}`, { defaultValue: t('social.errors.generic') })}
              </Text>
              <Text style={styles.retry}>{t('common.retry')}</Text>
            </Pressable>
          ) : null}

          {!loading && !error && (summary?.ratingCount || 0) === 0 ? (
            <Text style={styles.empty}>{t('social.friendsRatings.empty')}</Text>
          ) : null}

          {!loading && !error && (summary?.ratingCount || 0) > 0 ? (
            <>
              <View style={styles.summary}>
                <Text style={styles.average}>
                  {t('social.friendsRatings.average', {
                    rating: formatAverage(summary.average),
                  })}
                </Text>
                <Text style={styles.count}>
                  {t('social.friendsRatings.basedOn', { count: summary.ratingCount })}
                </Text>
                <View style={styles.avatars}>
                  {items.slice(0, 5).map((item) => (
                    <View key={item.activityId || item.actor?.userId} style={styles.avatarWrap}>
                      {item.actor?.avatarUrl ? (
                        <Image source={{ uri: item.actor.avatarUrl }} style={styles.avatar} />
                      ) : (
                        <View style={styles.avatarFallback}>
                          <Ionicons name="person" size={12} color={colors.primary} />
                        </View>
                      )}
                    </View>
                  ))}
                </View>
              </View>

              <View style={styles.divider} />

              {items.map((item) => {
                const handle = item.actor?.username ? `@${item.actor.username}` : item.actor?.displayName;
                return (
                  <View key={item.activityId || `${item.actor?.userId}:${item.rating}`} style={styles.row}>
                    <View style={styles.rowTop}>
                      <Pressable
                        style={styles.userHit}
                        onPress={() => {
                          if (item.actor?.username) {
                            router.push(`/user/${encodeURIComponent(item.actor.username)}`);
                          }
                        }}
                      >
                        {item.actor?.avatarUrl ? (
                          <Image source={{ uri: item.actor.avatarUrl }} style={styles.rowAvatar} />
                        ) : (
                          <View style={[styles.rowAvatar, styles.avatarFallback]}>
                            <Ionicons name="person" size={14} color={colors.primary} />
                          </View>
                        )}
                        <Text style={styles.handle} numberOfLines={1}>{handle}</Text>
                      </Pressable>
                      <Text style={styles.score}>
                        {Number(item.rating).toFixed(Number.isInteger(Number(item.rating)) ? 0 : 1)}
                      </Text>
                    </View>
                    {item.hasReview && item.activityId ? (
                      <Pressable
                        onPress={() => {
                          router.push(`/social/discussion?activityId=${encodeURIComponent(item.activityId)}`);
                        }}
                        hitSlop={8}
                        style={styles.reviewHit}
                      >
                        <Text style={styles.reviewLink}>{t('social.friendsRatings.review')}</Text>
                      </Pressable>
                    ) : null}
                {item.reviewText ? (
                  <View style={styles.preview}>
                    <SpoilerReviewBlock
                      resetKey={item.activityId}
                      reviewText={
                        item.reviewText.length > 120
                          ? `${item.reviewText.slice(0, 117).trim()}…`
                          : item.reviewText
                      }
                      containsSpoilers={Boolean(item.reviewContainsSpoilers)}
                      compact
                    />
                  </View>
                ) : null}
                  </View>
                );
              })}

              {hasMore ? (
                <Pressable
                  accessibilityRole="button"
                  disabled={loadingMore}
                  onPress={() => load({ reset: false })}
                  style={styles.seeAll}
                >
                  <Text style={styles.seeAllText}>
                    {loadingMore ? t('common.loading') : t('social.friendsRatings.seeAll')}
                  </Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginTop: spacing.sm,
    gap: spacing.sm,
  },
  toggleRow: {
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
  toggleTitle: {
    ...typography.label,
    color: colors.text,
    fontWeight: '700',
  },
  toggleSubtitle: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  body: {
    padding: spacing.md,
    borderRadius: radii.lg,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    gap: spacing.sm,
  },
  centered: {
    paddingVertical: spacing.md,
    alignItems: 'center',
    gap: spacing.xs,
  },
  empty: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  retry: {
    ...typography.label,
    color: colors.primary,
  },
  summary: {
    gap: 4,
  },
  average: {
    ...typography.title,
    fontSize: 22,
    color: colors.primary,
  },
  count: {
    ...typography.caption,
    color: colors.textSecondary,
  },
  avatars: {
    flexDirection: 'row',
    marginTop: spacing.xs,
  },
  avatarWrap: {
    marginRight: -6,
  },
  avatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: colors.surface,
    backgroundColor: colors.surfaceElevated,
  },
  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceElevated,
    borderWidth: 2,
    borderColor: colors.surface,
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  row: {
    gap: 4,
    paddingVertical: spacing.xs,
  },
  rowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  userHit: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 36,
  },
  rowAvatar: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.surfaceElevated,
  },
  handle: {
    ...typography.body,
    fontWeight: '600',
    color: colors.text,
    flex: 1,
  },
  score: {
    ...typography.subtitle,
    fontSize: 16,
    color: colors.primary,
  },
  reviewHit: {
    marginLeft: 36,
    minHeight: 28,
    justifyContent: 'center',
  },
  reviewLink: {
    ...typography.label,
    color: colors.primary,
  },
  preview: {
    marginLeft: 36,
  },
  seeAll: {
    alignSelf: 'flex-start',
    paddingVertical: spacing.xs,
    minHeight: 32,
    justifyContent: 'center',
  },
  seeAllText: {
    ...typography.label,
    color: colors.primary,
  },
});
